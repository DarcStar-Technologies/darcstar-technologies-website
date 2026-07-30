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
 * The database the E2E SUITE points the preview at: one that resolves without DNS and refuses
 * instantly (DAR-85).
 *
 * NOT part of `previewVars`, and that separation is load-bearing rather than tidiness — see the
 * paired spec. `pnpm preview` must keep reaching whatever database `.env` names, because
 * `smoke:invite` and `smoke:waitlist` are hand-run AGAINST a preview and assert on rows in that
 * database; both even diagnose "is the preview pointed at a different database than .env?", which is
 * precisely the failure a var in `previewVars` would cause for every run of them. So this is a
 * TEST-HARNESS override, applied by playwright.config.ts, and `pnpm preview` alone never sees it.
 *
 * WHY A DEAD ADDRESS AT ALL, given the suite was already hermetic in CI. It was hermetic in CI only:
 * the placeholder was hand-written into a `.env` by the workflow (as ORIGIN once was — see above), so
 * a local run used the developer's real dev database. Measured on the dev DB: 5,118
 * `waitlist_funnel_event` rows against 0 leads and 0 submissions, i.e. a conversion readout computed
 * entirely over automated traffic. Same defect as DAR-79/DAR-81, one env var over — one suite testing
 * two different things, and the local half writing to shared data.
 *
 * WHY THIS SHAPE, and every column of this was measured rather than reasoned. Four probe requests
 * (`/waitlist`, `/waitlist/__data.json`, `POST /forgot-password`, `POST /api/auth/sign-up/email`)
 * against a real wrangler dev:
 *
 *   DATABASE_URL              DNS fail  Uncaught  workerd internal  our logs  sign-up  forgot-pw
 *   libsql://…invalid  (was)         9         3                 9         2      400        200
 *   libsql://127.0.0.1:1             0         0                 0         2      400        200
 *   (absent)                         0         0                 0         0      500        500
 *
 * An unresolvable HOSTNAME is what produced the noise DAR-85 was filed about: workerd logs each
 * failed DNS lookup itself, raises a `jsgInternalError` per attempt with a full native stack, and
 * leaves one rejection per query unobserved — `Uncaught Error: internal error; reference = …`, which
 * is indistinguishable from a real fault. An IP literal on a closed port fails at connect instead:
 * same rejection for the query, none of the machinery.
 *
 * THE ABSENT COLUMN IS THE TRAP, and it is why "no database" is the wrong way to say "no database".
 * `getDb()` throws when either var is missing, and `authOptions` calls it eagerly
 * (`drizzleAdapter(getDb(), …)`), so `getAuth()` throws and every auth route answers 500 — including
 * DAR-67's sign-up boundary, whose 400 EMAIL_PASSWORD_SIGN_UP_DISABLED becomes a 500 that
 * `expect(res.ok()).toBe(false)` still passes. That is exactly DAR-81's two-gates-failing-closed-
 * into-a-pass, reinstated. The requirement is therefore CONSTRUCTIBLE BUT UNREACHABLE: the client
 * must build, and only the query may fail.
 *
 * `libsql://` rather than `http://` (both measured identically quiet) so the client takes the same
 * hrana-over-HTTPS path a Turso URL takes in production; port 1 needs root to bind, so nothing can
 * answer it by accident.
 *
 * @returns {Record<string, string>}
 */
export function hermeticDbVars() {
	return {
		DATABASE_URL: 'libsql://127.0.0.1:1',
		DATABASE_AUTH_TOKEN: 'e2e-no-database'
	};
}

/**
 * `{NAME: VALUE}` → wrangler `--var NAME:VALUE` arguments.
 *
 * wrangler splits each pair on its FIRST colon, which is what lets ORIGIN carry a value that is
 * itself full of them (`http://localhost:4173`) without quoting.
 *
 * @param {Record<string, string>} vars
 * @returns {string[]}
 */
const varArgs = (vars) =>
	Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]);

/**
 * The vars `pnpm preview` always bakes, as wrangler arguments.
 *
 * @param {number} port
 * @returns {string[]}
 */
export function previewVarArgs(port) {
	return varArgs(previewVars(port));
}

/**
 * The e2e suite's additional database override, as wrangler arguments. Appended AFTER
 * `previewVarArgs` by playwright.config.ts, which is also after any `.env` entry — wrangler takes the
 * last `--var` for a repeated name, and a `--var` beats `.env` (both measured, DAR-81).
 *
 * @returns {string[]}
 */
export function hermeticDbVarArgs() {
	return varArgs(hermeticDbVars());
}
