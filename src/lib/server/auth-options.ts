// Env-free Better Auth options, kept separate from auth.ts so they can be shared with unit
// tests without pulling in $app/server or a DB client. auth.ts spreads these into the live
// instance; auth.spec.ts feeds them to a throwaway in-memory instance to assert the behaviour.

// #48: there's no sign-up UI, no rate limiting, and no route reads locals.user yet, so an open
// POST /api/auth/sign-up/email would let anyone create accounts in the production DB. Keep
// public sign-up closed until the gated area (#69) + rate limiting land — better-auth rejects a
// disabled sign-up with 400 before any DB write. `enabled` stays true so sign-IN keeps working
// for an admin provisioned out-of-band later.
export const emailAndPassword = {
	enabled: true,
	disableSignUp: true
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
	storage: 'database' as const
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
// Caveat: a session is trusted from the cookie for up to `maxAge`, so **server-side** revocation
// (deleting a `session` row out-of-band) lags that long. Sign-out is unaffected — it clears the
// `session_data` cookie immediately — and session EXPIRY is still honoured (the snapshot carries the
// session's own `expiresAt`). 5 min is a safe window for a single-operator admin area with no
// "revoke other sessions" feature.
export const session = {
	cookieCache: {
		enabled: true,
		maxAge: 300 // seconds
	}
};
