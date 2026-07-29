import { describe, expect, test } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { getIp } from 'better-auth/api';
import { advanced, CLIENT_IP_HEADER } from './auth-options';
import { authSubrequest } from './auth-subrequest';
import { appSourcePaths, importedNames, sourceText } from './source-scan';

// DAR-124. The auth rate limiter and the login audit both attribute a request to a client address,
// and before this ticket they read it from `x-forwarded-for` — which, on the direct /api/auth/*
// surface, is whatever the caller sent. Measured against the deployed prod Worker: four
// POST /sign-up/email with a rotating value all answered 400, while four on one fixed value tripped
// the cap at the fourth. So a caller chose its own bucket, and the sign-in,
// /request-password-reset and /send-verification-email caps did not bind at all.
//
// The fix is one line of config plus the thing that makes it hold: every form action that hands a
// request to `auth.handler()` must set the SAME header the config reads. Nothing enforced that
// before — the ticket's own note was that no test asserted a form action forwards the client address
// at all — and the failure is silent, because a mismatch does not error. Better Auth simply resolves
// no address and every form submission lands in its shared `no-trusted-ip` bucket, which turns a
// per-IP cap into a global one.
//
// So the assertions below come in three layers, and none of them is redundant:
//   1. the builder sets the header the CONFIG names (not a literal restated here);
//   2. Better Auth's own `getIp`, given the shipped options, reads that header and IGNORES
//      x-forwarded-for — the behavioural claim, made against the real resolver rather than a
//      re-implementation of it;
//   3. a source scan: every file that touches `auth.handler` goes through the builder, so a fifth
//      action cannot hand-roll its own headers and quietly merge everybody's buckets.

describe('authSubrequest', () => {
	const ORIGIN = 'https://example.test';
	const build = (getClientAddress: () => string) =>
		authSubrequest({
			path: '/api/auth/sign-in/email',
			origin: ORIGIN,
			body: { email: 'op@example.com', password: 'a-long-enough-password' },
			getClientAddress
		});

	test('sets the client address on the header the limiter is configured to read', () => {
		const { request, clientIp } = build(() => '203.0.113.7');

		// Read through the CONSTANT, deliberately. Restating 'cf-connecting-ip' here would let the
		// config and the forwarding drift apart while this test agreed with a copy of the old value —
		// which is the exact failure the constant exists to prevent.
		expect(request.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7');
		expect(clientIp).toBe('203.0.113.7');
		expect(request.method).toBe('POST');
		expect(request.url).toBe(`${ORIGIN}/api/auth/sign-in/email`);
	});

	test('does NOT set x-forwarded-for — the header a caller controls', async () => {
		const { request } = build(() => '203.0.113.7');

		// Not merely "the new header is set": leaving the old one on would keep working in a preview
		// and keep the forgeable path alive anywhere the header order changed back.
		expect(request.headers.get('x-forwarded-for')).toBeNull();
		expect(await request.json()).toEqual({
			email: 'op@example.com',
			password: 'a-long-enough-password'
		});
	});

	test('omits the header when the adapter cannot resolve an address', () => {
		// Two ways it fails, and the polarity matters for both: no address means NO header, so Better
		// Auth resolves nothing. The alternative — falling back to some placeholder — would key every
		// unresolvable request into one shared bucket, which is the lockout this ticket is closing.
		const thrown = build(() => {
			throw new Error('adapter cannot resolve an address');
		});
		expect(thrown.request.headers.get(CLIENT_IP_HEADER)).toBeNull();
		expect(thrown.clientIp).toBeNull();

		const empty = build(() => '');
		expect(empty.request.headers.get(CLIENT_IP_HEADER)).toBeNull();
		expect(empty.clientIp).toBeNull();
	});
});

describe('the shipped ip config, through Better Auth’s own resolver', () => {
	// A throwaway instance carrying the SHIPPED `advanced` options, so these assert what the deployed
	// worker does rather than what this spec believes it does. `getIp` is the single function both the
	// rate limiter (via createRateLimitKey) and the login audit go through.
	const auth = betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		advanced
	});
	const resolve = (headers: Record<string, string>) =>
		getIp(new Headers(headers), auth.options as never);

	test('resolves the client address from the configured header', () => {
		expect(resolve({ [CLIENT_IP_HEADER]: '203.0.113.7' })).toBe('203.0.113.7');
	});

	test('IGNORES x-forwarded-for, whatever it says', () => {
		// The whole ticket in one assertion. Before DAR-124 this returned '198.51.100.9' — the value
		// the CALLER chose — and that value became the rate-limit bucket key and the audit row's ip.
		//
		// Phrased as "never the caller's value" rather than "null", because `getIp` falls back to
		// 127.0.0.1 when `isTest()` or `isDevelopment()` (better-auth's utils/ip.ts) and vitest sets
		// NODE_ENV=test, so the honest null only happens in a deployed worker. Asserting null here
		// would have been asserting the test environment. What matters in both is the same: nothing a
		// caller sends can steer this.
		expect(resolve({ 'x-forwarded-for': '198.51.100.9' })).not.toBe('198.51.100.9');

		// And it does not merely prefer one over the other: a caller sending BOTH cannot displace the
		// address the edge attributed to it. `getIp` walks the configured list in order and stops at
		// the first that resolves, so a fallback entry would make this line read '198.51.100.9'.
		expect(resolve({ [CLIENT_IP_HEADER]: '203.0.113.7', 'x-forwarded-for': '198.51.100.9' })).toBe(
			'203.0.113.7'
		);
	});

	test('the configured list is exactly one header', () => {
		// Stated directly because the assertion above can only see the headers it thinks to send. A
		// third entry — `true-client-ip`, say, which measurement showed arrives verbatim from the
		// caller on a non-Enterprise plan — would reinstate the hole and pass every test above.
		expect(advanced.ipAddress.ipAddressHeaders).toEqual([CLIENT_IP_HEADER]);
	});
});

describe('nothing hand-rolls an auth sub-request or a client-address header', () => {
	const MODULE = '$lib/server/auth-subrequest';
	const CLIENT_ADDRESS_HEADER =
		/['"](?:x-forwarded-for|cf-connecting-ip|true-client-ip|x-real-ip)['"]/i;

	// THE RULE IS AN INVERSION, and getting here took three tries — each earlier cut tried to IDENTIFY
	// the callers of Better Auth's router by text, and each was walked past by a spelling nobody had
	// thought of:
	//
	//   1. `auth.handler(`  — missed `auth.handler.bind(auth)`            (mutation: 12/12 green)
	//   2. `auth.handler`   — missed `getAuth().handler(...)`, which is the MOST natural spelling of
	//                         all, since it needs no variable named `auth` (mutation: 12/12 green)
	//
	// Deriving from `getAuth` importers is no better: eleven files import it and most reach
	// `auth.api.*`, which builds no sub-request and must not be forced through this builder — the rule
	// would be a false-positive machine. So the question "who calls the router?" is abandoned. What
	// the fix actually needs is far simpler and needs no caller identification at all:
	//
	//   * only ONE file may NAME a client-address header, and
	//   * NO file may hand-build a request at an /api/auth path.
	//
	// Both hold whatever the auth instance is called, so no spelling escapes them.

	// ALLOWLIST, not a scan list, and the polarity is the point (DAR-102): deleting an entry makes the
	// rule STRICTER, so an edit in either direction reports itself — where deleting a scan-list entry
	// silently blinds the scan. Each entry carries its reason.
	const MAY_NAME_A_HEADER: Record<string, string> = {
		'src/lib/server/auth-options.ts':
			'defines CLIENT_IP_HEADER — the single name the config reads and the builder sets'
	};

	test('exactly one file names a client-address header, and it is the one that defines the constant', () => {
		const naming = appSourcePaths()
			.filter((path) => CLIENT_ADDRESS_HEADER.test(sourceText(path)))
			.sort();

		// `toEqual` against the allowlist keys, not `arrayContaining`: this fails in BOTH directions.
		// A new file naming a header is an offender; an allowlisted file that STOPS naming one means
		// the entry has rotted into a name nobody checks, which is how an allowlist decays into
		// decoration.
		expect(naming).toEqual(Object.keys(MAY_NAME_A_HEADER).sort());
	});

	test('no file builds its own request at an /api/auth path', () => {
		// The other half, and the one that survives a caller who forwards NOTHING — no header literal
		// to catch, so the rule above would not see it, and the bucket silently becomes global.
		// `auth-subrequest.ts` itself does not match: it takes the path as a parameter, so the literal
		// lives at the call sites and the `new Request(` lives here, never in the same file.
		const handRolled = appSourcePaths().filter((path) => {
			const source = sourceText(path);
			return /new Request\s*\(/.test(source) && /['"`]\/api\/auth/.test(source);
		});
		expect(handRolled).toEqual([]);
	});

	test.each([
		'src/routes/login/+page.server.ts',
		'src/routes/forgot-password/+page.server.ts',
		'src/routes/reset-password/+page.server.ts'
	])('%s builds its sub-request through the builder', (path) => {
		// The positive floor. The two rules above are negative — they say what must not appear — and a
		// negative rule over an empty set passes just as happily when the files it means to govern have
		// been deleted or renamed. This says the actions that exist today do the right thing.
		expect(importedNames(path, MODULE)).toContain('authSubrequest');
	});
});
