// The env `pnpm preview` overrides because the production values cannot work against localhost
// (DAR-81). Every entry here is a deliberate divergence from what a deployed Worker runs, so every
// entry carries the reason it is right in a preview and wrong anywhere else.
//
// They are baked into the wrangler invocation rather than left to `.env`, for two reasons:
//
//   1. A `--var` beats a `.env` entry (measured), so what the e2e suite exercises does not depend on
//      what a developer happens to have in their own `.env`. That was the actual defect DAR-81
//      found: CI wrote `ORIGIN=http://localhost:4173` into `.env` by hand and so reached the auth
//      API, while a local run — where `.env` holds the *dev server's* origin, and a worktree
//      previews on a derived port anyway — did not. The same suite tested two different things.
//   2. Anything that must track the port can be DERIVED from the port this run is binding, instead
//      of written down a second time and pinned by a spec to stop the two drifting.
//
// Extracted from preview.mjs so it can be asserted without starting wrangler — the specs live in
// preview-port.spec.ts, next to the port derivation two of these values depend on.

/**
 * The vars `pnpm preview` bakes, given the port it is about to bind.
 *
 * @param {number} port
 * @returns {Record<string, string>}
 */
export function previewVars(port) {
	return {
		// Cloudflare's universal always-pass Turnstile TEST keys. A real sitekey rejects localhost, so
		// these are what let a widget mount in preview at all. DAR-67 removed the only widget, but
		// auth.ts keeps the env deliberately (re-opening public sign-up should be a plugin + a form,
		// not a secrets dance), so they stay here too — see docs/auth.md.
		TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
		TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',

		// Better Auth's baseURL. `isAuthPath()` (integrations/svelte-kit.mjs) drops any request whose
		// origin differs from it, so under the production ORIGIN the auth API is not mounted at all in
		// a preview: every /api/auth/* request 404s in SvelteKit's router before a line of auth logic
		// runs. Deriving it from the port this script is binding is what makes the local suite and CI
		// exercise the same code path by construction.
		ORIGIN: `http://localhost:${port}`,

		// Run the rate limiter WITHOUT a database. It executes before every /api/auth route, so with
		// the shipped `storage: 'database'` a DB round-trip is the precondition for reaching any auth
		// logic — and the e2e suite is hermetic (a placeholder DATABASE_URL that resolves to nothing),
		// which made every auth endpoint answer 500, GET /ok included. The limiter still RUNS here;
		// only its store changes. See auth.ts for the fail-safe polarity that keeps this value from
		// meaning anything on a deployed Worker.
		AUTH_RATE_LIMIT_STORAGE: 'memory'
	};
}

/**
 * The same vars as wrangler `--var NAME:VALUE` arguments.
 *
 * wrangler splits each pair on its FIRST colon, which is what lets ORIGIN carry a value that is
 * itself full of them (`http://localhost:4173`) without quoting.
 *
 * @param {number} port
 * @returns {string[]}
 */
export function previewVarArgs(port) {
	return Object.entries(previewVars(port)).flatMap(([name, value]) => [
		'--var',
		`${name}:${value}`
	]);
}
