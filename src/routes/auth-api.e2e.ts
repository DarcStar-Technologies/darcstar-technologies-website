import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { rateLimit } from '../lib/server/auth-options';

// Better Auth's own endpoints, asserted against the deployed worker (DAR-81).
//
// These could not be written before. Two gates stood in front of them, and both were invisible —
// they turned every request into a plausible-looking failure rather than an error:
//
//   1. `isAuthPath()` mounts /api/auth ONLY for requests whose origin matches the configured
//      baseURL, so under the production ORIGIN the auth API did not exist in a preview and every
//      request 404'd in SvelteKit's router. `pnpm preview` now bakes an ORIGIN derived from the port
//      it binds (scripts/preview-vars.mjs).
//   2. The rate limiter runs before every auth route and stores its counters in the DATABASE, so
//      against this suite's placeholder DATABASE_URL every endpoint answered 500 — GET /ok
//      included — before better-auth decided anything. The preview now runs the limiter in memory.
//
// Both gates fail CLOSED into something that reads like a passing test: a `!res.ok()` assertion is
// satisfied by a 404 and by a 500 just as happily as by the refusal it means to check. That is why
// the tests below assert the exact status and better-auth's own error `code`, and why the mount is
// asserted separately and first — so a regression in the harness reports itself as a broken harness
// rather than as a boundary that still holds.
//
// Still DB-free, and that bounds what belongs here: anything reading or writing a row (sign-in,
// password reset, verification resend) 500s against the placeholder DB and stays in the unit specs
// (auth.spec.ts) or the hand-run smokes (scripts/smoke-invite.ts).

/**
 * The rule the 429 test asserts, read from the config that ships it rather than restated here.
 *
 * Two consequences, both wanted: raising the cap updates the test, and DELETING the rule is a
 * `pnpm check` error rather than a test that keeps passing against better-auth's built-in default.
 *
 * Importing out of `$lib/server` is deliberate and is what `auth-options.ts` is for — it is the
 * env-free half of the config, split from `auth.ts` precisely so tests can read it without dragging
 * in `$app/server` or a DB client. `auth.spec.ts` does the same.
 */
const SIGN_UP_RULE = rateLimit.customRules['/sign-up/email'];

/**
 * The window of better-auth's OWN built-in rule for `/sign-up*` (api/rate-limiter, 10s/3), which is
 * what applies if ours is ever removed.
 *
 * It exists here because its `max` is also **3**: the number of requests it takes to trip the
 * limiter cannot tell the two rules apart, so a test that only counted would pass just as happily
 * against a config that had lost `customRules` entirely. The window is the only thing that
 * distinguishes them, and `X-Retry-After` is where the limiter reports it.
 */
const BUILT_IN_SIGN_UP_WINDOW_SECONDS = 10;

/**
 * A client IP no other test, and no retry of this one, will use.
 *
 * DAR-92. The limiter keys each bucket `<ip>|<path>` and resolves the ip from `x-forwarded-for` —
 * the same header the app's own form actions set from `getClientAddress()` (login/+page.server.ts).
 * Nothing rewrites it between Playwright and a local wrangler, so the header we choose IS the
 * bucket. That is what makes a 429 assertable without shipping a rule that exists for the tests:
 * this file's probes spend private buckets, so exhausting one costs no other test its allowance and
 * ordering between them is not load-bearing.
 *
 * The randomness goes in the third and fourth groups DELIBERATELY: better-auth normalizes an IPv6
 * address to its /64 before keying (`normalizeIP`, default `ipv6Subnet: 64`), so two addresses
 * that differ only after the fourth group are one bucket. That leaves 2^32 of them, which is what
 * matters under `E2E_REUSE_SERVER=1`: the counters survive the run and the sign-up window is an
 * hour, so a collision would hand a "fresh" probe a bucket someone already spent. 2001:db8::/32 is
 * the documentation prefix (RFC 3849) — never routed, and not a range any real client arrives from.
 */
function freshProbeIp(): string {
	return `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
}

/**
 * One POST at the public sign-up endpoint, attributed to `ip`.
 *
 * Both headers carry the same address because the limiter reads whichever
 * `advanced.ipAddress.ipAddressHeaders` names — `x-forwarded-for` is better-auth's default and what
 * this repo runs today, and DAR-124 proposes moving to `cf-connecting-ip`. Measured: a local
 * wrangler passes a caller-supplied value through for BOTH (and sets `cf-connecting-ip: 127.0.0.1`
 * itself when the caller sends none), so supplying both means this test keeps isolating buckets
 * across that change instead of silently sharing one.
 */
function signUpProbe(request: APIRequestContext, ip: string) {
	return request.post('/api/auth/sign-up/email', {
		headers: { 'x-forwarded-for': ip, 'cf-connecting-ip': ip },
		data: { name: 'Probe', email: 'probe@example.com', password: 'a-long-enough-password' },
		failOnStatusCode: false
	});
}

test('the auth API is mounted on this origin', async ({ request }) => {
	// better-auth's liveness endpoint, and the only one that touches neither a row nor a session —
	// which makes it the honest test of "is the API here at all", separate from what it answers.
	const res = await request.get('/api/auth/ok', { failOnStatusCode: false });

	// A 404 means the origin gate closed (the preview's ORIGIN stopped matching the port it serves);
	// a 500 means the rate limiter went looking for the database again. Both are harness failures,
	// and both would otherwise surface as a puzzling failure in the boundary test below.
	expect(res.status(), 'GET /api/auth/ok — 404 = not mounted, 500 = limiter hit the DB').toBe(200);
	// toMatchObject, not toEqual: the claim is that better-auth answered this, not that its liveness
	// payload never grows a field.
	expect(await res.json()).toMatchObject({ ok: true });
});

// DAR-67's boundary, end to end: the acceptance criterion that ticket wanted and could not write.
// `auth.spec.ts` proves the CONFIG refuses public sign-up; this proves the deployed worker does,
// which is a different claim — it is the one that catches the config being right and the wiring
// being wrong.
test('public sign-up is refused by the deployed worker', async ({ request }) => {
	// A private bucket (DAR-92), so this asserts DAR-67's boundary and nothing else. It used to run
	// on whatever bucket the preview handed every anonymous caller, which made it spend one of the
	// three sign-up attempts an hour that everything else shared: under `E2E_REUSE_SERVER=1` the
	// fourth run within the hour answered 429, and in CI (`retries: 1`) a retry for any unrelated
	// reason found the bucket one closer to empty.
	const res = await signUpProbe(request, freshProbeIp());

	// The status and the code together are the point. 400 alone could be a malformed body; the code
	// is better-auth naming the reason, and it is what distinguishes "registration is closed" from
	// every other way this request could fail.
	//
	// A 429 here can no longer mean a spent bucket — this probe's is untouched by construction. It
	// would mean the header stopped reaching the limiter, which the rate-limit test below catches
	// directly.
	expect(res.status(), '429 = the per-probe bucket isolation broke, not a closed boundary').toBe(
		400
	);
	expect((await res.json()).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');

	// The fact the old version of this test asserted, kept because it is the one that matters if
	// better-auth ever refuses in a way that still mints something: no session, whatever the status.
	const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
	expect(cookies.some((h) => h.value.includes('session_token'))).toBe(false);
});

// DAR-92. The DB-backed limiter is a real security control on the public auth surface, and until
// this test every assertion about it was config-level: `auth.spec.ts` reads the options object, and
// nothing showed the deployed worker ever refusing anything. The claim here is narrow and end to
// end — the limiter counts real requests, refuses past the cap the config states, and does it
// BEFORE the endpoint, which is the sentence auth-options.ts uses to justify keeping a rule on an
// endpoint that already rejects everything ("the limiter runs first, so this is what stops a script
// from hammering a permanently-400ing endpoint for free").
test('the rate limiter refuses past the cap, before the endpoint', async ({ request }) => {
	const probe = freshProbeIp();

	// Inside the cap: the limiter passes these through and the endpoint refuses them for its own,
	// entirely different reason. Asserting the 400 (rather than merely "not 429") is what proves the
	// requests were counted rather than dropped — a limiter that refused early would fail here.
	for (let attempt = 1; attempt <= SIGN_UP_RULE.max; attempt++) {
		const allowed = await signUpProbe(request, probe);
		expect(allowed.status(), `request ${attempt} of ${SIGN_UP_RULE.max} is inside the cap`).toBe(
			400
		);
	}

	// One past the cap.
	const refused = await signUpProbe(request, probe);
	expect(refused.status(), `request ${SIGN_UP_RULE.max + 1} is past the cap`).toBe(429);

	// The limiter answered, not the endpoint. The load-bearing evidence is above — the endpoint
	// refuses UNCONDITIONALLY, so the three 400s prove it was reached and this 429 proves something
	// upstream of it answered instead. This adds the one case that leaves: a refusal raised after the
	// sign-up handler had already done its work. Phrased as "not the endpoint's error" rather than
	// "carries no code at all", because better-auth giving its 429 body a `code` some day would be a
	// perfectly ordinary upstream change and must not turn this red.
	expect((await refused.json()).code).not.toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');

	// WHICH rule refused. `max` is 3 in both ours and better-auth's built-in `/sign-up*` rule, so
	// everything above holds just as well against a config that has lost `customRules`; only the
	// window separates them, and the limiter reports it here (`getRetryAfter` — the remainder of the
	// window from the last allowed request, which was milliseconds ago).
	// `Retry-After` as a fallback: better-auth emits the X- form today, and RFC 6648 deprecated that
	// prefix, so a rename upstream is ordinary. Both mean delay-seconds, so reading either asserts the
	// same thing — and a missing header leaves NaN, which fails every comparison below rather than
	// passing one.
	const headers = refused.headers();
	const retryAfter = Number(headers['x-retry-after'] ?? headers['retry-after']);
	// Two bounds, and the wide one is not redundant: `window - 60` is the tight check while the rule
	// is measured in hours, but it goes NEGATIVE — and therefore vacuous — the moment someone shortens
	// the window below a minute. The built-in floor is what still separates the rules there.
	expect(
		retryAfter,
		'X-Retry-After should report the window that refused this request'
	).toBeGreaterThan(BUILT_IN_SIGN_UP_WINDOW_SECONDS);
	expect(retryAfter).toBeGreaterThan(SIGN_UP_RULE.window - 60);
	expect(retryAfter).toBeLessThanOrEqual(SIGN_UP_RULE.window);

	// The buckets really are per-IP — which is both the property that makes a shared cap survivable
	// in production and the assumption every other test in this file now rests on. A second probe,
	// one request, against the endpoint whose bucket was just emptied: it must still be inside its
	// own cap. If `x-forwarded-for` ever stopped reaching the limiter (a runtime that rewrites it,
	// or an `advanced.ipAddress` config that reads a different header), every probe here would share
	// better-auth's no-trusted-ip fallback bucket and this is the assertion that says so — the rest
	// of the test would go on passing on a fresh preview and quietly break the two tests above.
	const unrelated = await signUpProbe(request, freshProbeIp());
	expect(unrelated.status(), 'a different IP must not inherit the exhausted bucket').toBe(400);
});
