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
