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
