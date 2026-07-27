// Shared plumbing for the manual smoke scripts (`smoke-signin`, `smoke-invite`).
//
// These scripts drive the REAL endpoints of a built preview over HTTP, with no browser, so they all
// need the same four things: the checkout's own preview origin (DAR-79), a no-JS form POST that
// satisfies SvelteKit's CSRF origin check, the session cookie out of a `Set-Cookie` list, and a
// pass/fail vocabulary that exits non-zero on the first failure.
//
// Kept as `.mjs` rather than `.ts` deliberately: `smoke-signin.mjs` runs under plain `node`, and a
// `.mjs` cannot import a `.ts` module. TypeScript smoke scripts (run under tsx, so they can import
// the real drizzle schema) import this exactly the way `preview-port.spec.ts` imports
// `preview-port.mjs`.

import { previewUrl } from './preview-port.mjs';

/**
 * Report a failed assertion and stop. The scripts are strictly sequential — a failed step
 * invalidates everything after it, and a half-run lifecycle leaves rows nobody expects.
 *
 * The `never` is load-bearing for the TypeScript smoke scripts: without it a guard like
 * `if (!email) die(…)` would not narrow `email`, and JSDoc is how a `.mjs` says so.
 *
 * @param {string} msg
 * @returns {never}
 */
export function die(msg) {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

export function ok(msg) {
	console.log(`✓ ${msg}`);
}

/**
 * The origin under test: `SMOKE_BASE`, else this checkout's own preview port — 4173 in the main
 * checkout, a derived slot in a worktree (DAR-79). Trailing slash stripped so callers can append a
 * path without doubling it.
 */
export function smokeBase() {
	return (process.env.SMOKE_BASE || previewUrl()).replace(/\/$/, '');
}

/**
 * Flatten a response's `Set-Cookie` list into a request `cookie` header. Attributes are dropped —
 * a client sends back name=value only, and keeping `HttpOnly`/`Path` would make the header invalid.
 */
export function cookieHeader(response) {
	return response.headers
		.getSetCookie()
		.map((c) => c.split(';', 1)[0])
		.join('; ');
}

/**
 * A native (no-JS) form POST: url-encoded body, `origin` to satisfy SvelteKit's CSRF check, and
 * `accept: text/html` so SvelteKit answers with the native 303/re-render rather than the enhanced
 * JSON action response a wildcard `accept` would get.
 *
 * `redirect: 'manual'` throughout — every one of these assertions is about the status and the
 * `location`, and a followed redirect would erase both.
 */
export function formPost(base, path, body, cookie) {
	const headers = {
		'content-type': 'application/x-www-form-urlencoded',
		accept: 'text/html',
		origin: new URL(base).origin
	};
	if (cookie) headers.cookie = cookie;
	return fetch(`${base}${path}`, {
		method: 'POST',
		redirect: 'manual',
		headers,
		body: new URLSearchParams(body)
	});
}

/** How long to wait out Better Auth's sign-in window before retrying a 429 (its built-in per-path
 *  rule on `/sign-in/email` is a handful of requests over a few seconds). */
const RATE_LIMIT_RETRY_MS = 15_000;

/**
 * Sign in through the `/login` form action — the no-JS path, which forwards to Better Auth's handler
 * directly and therefore works against ANY origin/port (no ORIGIN match needed, unlike a request
 * straight to `/api/auth/*`). Returns the raw response; callers assert the status and pull the
 * cookie, because what a successful sign-in should look like differs per script.
 *
 * A 429 is waited out ONCE, loudly. These scripts spend two sign-ins each, so running two of them
 * back to back trips the limiter on the fourth — a property of our own cadence, not of the code under
 * test, and one that otherwise leaves a half-finished lifecycle behind. A SECOND 429 is returned to
 * the caller to report: by then something other than this script is holding the bucket down.
 */
export async function signIn(base, email, password) {
	const first = await formPost(base, '/login?/signin', { email, password });
	if (first.status !== 429) return first;
	console.log(`… sign-in rate-limited; waiting ${RATE_LIMIT_RETRY_MS / 1000}s for the window`);
	await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
	return formPost(base, '/login?/signin', { email, password });
}
