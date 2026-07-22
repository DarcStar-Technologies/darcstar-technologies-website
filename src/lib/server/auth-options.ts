// Env-free Better Auth options, kept separate from auth.ts so they can be shared with unit
// tests without pulling in $app/server or a DB client. auth.ts spreads these into the live
// instance; auth.spec.ts feeds them to a throwaway in-memory instance to assert the behaviour.

// #96 (PR 2): public sign-up is now OPEN — but scoped. The original #48 lockdown (`disableSignUp`)
// closed it until the gated area + rate limiting existed; both do now, and two controls gate the
// reopened surface: Cloudflare Turnstile on POST /sign-up/email (auth.ts `captcha` plugin) and
// `requireEmailVerification` below. So a bot must pass a challenge AND control the mailbox before the
// account is usable.
//
// `requireEmailVerification: true` blocks sign-IN for ANY `emailVerified: false` user (better-auth
// throws 403 EMAIL_NOT_VERIFIED — see sign-in.mjs). Existing staff were all created unverified, so
// they'd be locked out; the drizzle `0003_verify_existing_users` migration flips them to verified
// before this deploys, and both roster-create (admin/users) and `pnpm admin:create` now set
// `emailVerified: true` so new staff stay signed-in-able. See docs/auth.md.
//
// Behavioral only (neither key affects the generated schema — the `verification` table + the
// `user.emailVerified` column already exist), so this stays shared with the CLI config without
// mirroring a table.
export const emailAndPassword = {
	enabled: true,
	disableSignUp: false,
	requireEmailVerification: true
};

// #69: the admin login (`/login`) makes sign-in publicly reachable for the first time, so
// rate-limit the auth endpoints. `storage: 'database'` persists the counters in a `rateLimit`
// table — the durable choice on Cloudflare, where in-memory state resets on every isolate spin-up
// (a per-isolate memory limiter is trivially defeated by fanning requests across isolates). Better
// Auth applies stricter built-in per-path limits (sign-in/sign-up) on top of its window/max
// defaults. This is **schema-affecting** (it adds the table), so it MUST be mirrored into the CLI
// config (auth-cli.ts) — sharing this one export keeps the two from drifting, same as above.
export const rateLimit = {
	enabled: true,
	storage: 'database' as const,
	// #96 (PR 2): public sign-up is a new abuse surface. Tighten it past Better Auth's defaults —
	// at most 3 attempts per hour per IP on POST /sign-up/email — so a Turnstile-solving bot still
	// can't mint accounts in bulk. Behavioral (no schema impact); shared with the CLI config, which
	// ignores limits at generation time.
	customRules: {
		'/sign-up/email': { window: 3600, max: 3 }
	}
};

// Cookie-cache the session. Since #87 exposed sign-in state site-wide, a signed-in operator's every
// page view resolves the session via `getSession` in `hooks.server.ts` — which, by default, is a DB
// round-trip per view. With `cookieCache`, Better Auth writes a **signed** (HMAC) snapshot of the
// session+user into a short-lived `session_data` cookie; within `maxAge` seconds `getSession` serves
// from that cookie (signature verify only, no DB) and never queries. The session TOKEN is already a
// signed cookie, so a forged token is rejected before any DB read regardless — this is purely a
// read-load optimization, not a security control. Behavioral, **not schema-affecting** (a cookie,
// no table), so — unlike `rateLimit` — it stays OUT of the CLI config (auth-cli.ts).
//
// Revocation: `hooks.server.ts` resolves the session AUTHORITATIVELY (passes `disableCookieCache`)
// on the auth-owned surfaces (`/admin`, `/login`, `/api/auth/*`), so the roster's force-logout /
// disable (#89) — which delete the target's `session` row — take effect on the target's very next
// request there, NOT up to `maxAge` later. The cookie-cache only fronts the site-wide navbar on
// ordinary pages, where a stale "signed in" snapshot (≤ `maxAge`) is cosmetic. Sign-out clears
// `session_data` immediately, and session EXPIRY is always honoured (the snapshot carries its own
// `expiresAt`). To make navbar staleness immediate too you'd drop/shrink the cache (a per-view DB
// read); not worth it for a cosmetic reflection.
export const session = {
	cookieCache: {
		enabled: true,
		maxAge: 300 // seconds
	}
};
