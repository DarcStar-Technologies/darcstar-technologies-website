import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	PREVIEW_WORKER_NAME,
	PROD_WORKER_NAME,
	trustedOrigins,
	workersDevOrigin
} from './auth-options';

// DAR-131: the preview Worker every doc described did not exist, and nothing could have said so —
// "is this Worker deployed?" is not a question a test can ask. What IS checkable is the half that
// lives in the repo: `wrangler.jsonc` names the Worker and sets the `ORIGIN` it will serve, while
// TypeScript names it again for `trustedOrigins`, and those two copies agreeing is what makes the
// provisioned environment usable. This is `preview-port.spec.ts`'s situation — a rule with one half
// outside TypeScript's reach — so it gets the same treatment.
//
// The failure this guards is silent in the way DAR-131's was. Nothing crashes if `ORIGIN` stops
// matching the Worker's own host: the site keeps serving, and only `/api/auth/*` quietly stops
// mounting (better-auth's `isAuthPath()` compares the request origin to `baseURL`), which is
// precisely the DAR-81 symptom that made the preview environment worthless before it was provisioned.

/**
 * `wrangler.jsonc` as data.
 *
 * Comments have to come out before `JSON.parse`, and the obvious stripper — `//` to end of line — is
 * exactly wrong for THIS file: every value worth asserting on here is a URL, so `"https://…"` would
 * lose its host and the spec would confidently check a mangled config. Hence a stripper that tracks
 * string literals, and hence the first test below, which is a real guard rather than a formality.
 */
function stripJsonComments(text: string): string {
	let out = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const next = text[i + 1];

		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false;
				out += char;
			}
			continue;
		}
		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += char;
			// A backslash escapes the next character, including a quote — consume both, or `"a\""`
			// would be read as ending one character early.
			if (char === '\\') {
				out += next ?? '';
				i++;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}
		if (char === '/' && next === '/') {
			inLineComment = true;
			i++;
			continue;
		}
		if (char === '/' && next === '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		out += char;
	}

	return out;
}

type WranglerEnv = { name?: string; vars?: Record<string, string>; assets?: unknown };
type WranglerConfig = WranglerEnv & { env?: Record<string, WranglerEnv> };

const wrangler: WranglerConfig = JSON.parse(
	stripJsonComments(readFileSync('wrangler.jsonc', 'utf8'))
);

describe('wrangler.jsonc agrees with the Worker names TypeScript uses', () => {
	test('the comment stripper leaves a URL intact', () => {
		const parsed = JSON.parse(
			stripJsonComments(`{
				// a real comment, mentioning https://not-a-value.example
				"origin": "https://darcstar.tech", // trailing comment
				/* block */ "escaped": "a \\" // not a comment"
			}`)
		);
		expect(parsed).toEqual({ origin: 'https://darcstar.tech', escaped: 'a " // not a comment' });
	});

	test('the production Worker is the one TypeScript names', () => {
		expect(wrangler.name).toBe(PROD_WORKER_NAME);
	});

	test('[env.preview] exists and is a SEPARATE Worker', () => {
		// Asserted before anything reads through it: every check below passes vacuously against a
		// config with no preview env at all, which is the state DAR-131 found the account in.
		expect(wrangler.env?.preview).toBeDefined();
		expect(wrangler.env?.preview?.name).toBe(PREVIEW_WORKER_NAME);
		expect(PREVIEW_WORKER_NAME).not.toBe(PROD_WORKER_NAME);
	});

	test("the preview Worker's ORIGIN is its own host, so /api/auth/* mounts there", () => {
		expect(wrangler.env?.preview?.vars?.ORIGIN).toBe(workersDevOrigin(PREVIEW_WORKER_NAME));
	});

	test('the preview env redeclares `assets`, which wrangler does not inherit', () => {
		// `vars` and `assets` are the two non-inheritable keys: a named env that omits `assets` deploys
		// a Worker with no static files rather than failing, so the omission shows up as a broken site.
		expect(wrangler.env?.preview?.assets).toEqual(wrangler.assets);
	});

	test('trustedOrigins is exactly the four hosts, written out', () => {
		// Spelled literally, and the case it uniquely catches is narrower than it first looks — worth
		// stating exactly, since two wider claims about it were wrong when measured. A malformed
		// pattern is already caught above (those assertions write `*-` out themselves), and a rename
		// in ONE file is caught by the wrangler.jsonc pins. What reaches this test alone is a
		// COORDINATED rename — both files edited together, which type-checks and satisfies every
		// other assertion here (measured: 1 failed, 6 passed).
		//
		// That is worth a test because these are the names of Cloudflare Workers that actually exist.
		// Renaming them in the repo without re-provisioning produces a config describing a Worker
		// that isn't there — which is precisely the state DAR-131 was filed about. Doubles as the
		// proof that DAR-131's refactor away from a hand-written list changed nothing.
		expect(trustedOrigins).toEqual([
			'https://darcstar-technologies-website.darcstar.workers.dev',
			'*-darcstar-technologies-website.darcstar.workers.dev',
			'https://darcstar-technologies-website-preview.darcstar.workers.dev',
			'*-darcstar-technologies-website-preview.darcstar.workers.dev'
		]);
	});

	test("the production wildcard does NOT cover the preview Worker's version URLs", () => {
		// The reason `trustedOrigins` carries four entries and not two. A preview version host ends
		// `-website-preview.…`, so it fails a suffix match against the production `*-website.…`
		// pattern — near enough to read as covered, and covering nothing.
		const previewVersionHost = `abc1234-${PREVIEW_WORKER_NAME}.darcstar.workers.dev`;
		expect(previewVersionHost.endsWith(`-${PROD_WORKER_NAME}.darcstar.workers.dev`)).toBe(false);

		expect(trustedOrigins).toContain(`*-${PREVIEW_WORKER_NAME}.darcstar.workers.dev`);
		expect(trustedOrigins).toContain(workersDevOrigin(PREVIEW_WORKER_NAME));
	});
});
