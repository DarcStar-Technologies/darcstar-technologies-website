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
	// DAR-67: public self-signup is CLOSED again — accounts are invite-only. Staff pick a prospect off
	// /admin/waitlist and mail them an activation link; the admin plugin's roster create-user is a
	// different endpoint and does NOT consult this flag (plugins/admin), so both staff paths still mint
	// accounts. This is the boundary: better-auth rejects POST /sign-up/email with
	// EMAIL_PASSWORD_SIGN_UP_DISABLED at the router (api/routes/sign-up.mjs), so hiding the page is
	// cosmetic and this line is the gate. `requireEmailVerification` below stays on for the accounts
	// that already exist — both staff paths mark their creations verified.
	disableSignUp: true,
	requireEmailVerification: true
};

// How long a SELF-SERVICE password-reset token stays valid: an hour, matching the verification token
// and the "expires in one hour" copy in the reset email. Exported rather than inlined so the config
// value and the copy have one source.
export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 3600;

// How long an INVITATION stays valid (DAR-67). A week, deliberately much longer than a self-service
// reset, because the two are answers to different questions. A reset is minted seconds after someone
// asks for it, with the tab still open — an hour is generous. An invitation arrives unrequested, and
// the recipient may not read that mailbox until the weekend; an hour would mean most invitations were
// dead on arrival, and the recovery path (a fresh link from /forgot-password) requires guessing that
// you have an account at all.
//
// This is a SEPARATE number rather than a bump to the constant above because better-auth's
// `resetPasswordTokenExpiresIn` governs only what its own `requestPasswordReset` endpoint stamps.
// Expiry is enforced from the verification row's `expiresAt` at both the GET callback and
// `consumeVerificationValue` (api/routes/password.mjs), so a hand-minted token carries its own
// lifetime and the public reset flow keeps its short one. Pinned by activation.spec.ts, which expires
// a minted row and proves better-auth rejects it — the property this whole scheme rests on.
//
// Known trade-off: the invite mints the same kind of token for an address that ALREADY has an account
// (a resend to someone who activated long ago), and there a week-long token is a week-long
// password-reset window on a live credential rather than on an empty account. It still only ever goes
// to the account's own address, and it's a deliberate staff action, so the exposure is a mailbox
// compromise within the week. Scoping the TTL by whether the account was just created was rejected:
// the email copy would then have to state two different lifetimes, and copy that lies about expiry is
// worse than the wider window.
export const ACTIVATION_TOKEN_TTL_SECONDS = 604_800; // 7 days

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
		// Kept after DAR-67 closed sign-up, though the endpoint now rejects every request anyway: the
		// limiter runs first, so this is what stops a script from hammering a permanently-400ing endpoint
		// for free. It also means re-opening registration doesn't have to remember to re-add a cap.
		'/sign-up/email': { window: 3600, max: 3 },
		// #115: the resend-verification affordance (signup "check your email" panel → POST
		// /send-verification-email) is an email-SEND trigger, so it's an abuse surface too — bound it
		// per IP. A touch looser than sign-up (5 vs 3/hour): resending is a legitimate repeat action (a
		// dropped/spam-filed link), whereas creating accounts is not. The endpoint itself is already
		// anti-enumerating + constant-time (better-auth email-verification.mjs) and only actually mails
		// an unverified, existing account; this caps how often it can be poked regardless.
		'/send-verification-email': { window: 3600, max: 5 },
		// Password reset: `/request-password-reset` is an email-SEND trigger (abuse surface) — cap it
		// like sign-up (3/hour/IP). It's already anti-enumerating + constant-time (better-auth
		// password.mjs simulates the token path for unknown emails). `/reset-password` consumes a
		// single-use, unguessable token, so its risk is low; a modest cap (10/hour/IP) just bounds
		// blind token-guessing without punishing a user who mistypes a new password a few times.
		'/request-password-reset': { window: 3600, max: 3 },
		'/reset-password': { window: 3600, max: 10 }
	}
};

// DAR-124: the request header Better Auth resolves the client address from — for the rate-limit
// bucket key (`<ip>|<path>`, createRateLimitKey) AND for `login_audit.ip_address`, which both go
// through the same `getIp`. ONE constant because those two facts have to be the same string: the
// limiter reads whatever this names, and the form actions below set whatever this names, and a
// deploy where they disagree is not a broken build — it is every caller silently collapsing into
// better-auth's shared `no-trusted-ip` bucket, which is a lockout vector that looks like nothing.
//
// Better Auth's default is `x-forwarded-for`, and on Cloudflare that header is CALLER-CONTROLLED.
// Measured against the deployed prod Worker rather than inferred (the mistake DAR-92 made twice in
// its own docs): four POST /sign-up/email with a rotating x-forwarded-for all answered 400, while
// four on one fixed value tripped the cap at the fourth with `x-retry-after: 3600` — so the limiter
// was live, it was OUR rule enforcing, and the bucket was whatever the caller asked for. Rotating
// the header defeated the sign-in, /request-password-reset and /send-verification-email caps too.
//
// Cloudflare's proxy re-adds x-forwarded-for only AFTER all rule phases and a Worker runs before
// that (Request Header Modification docs), which is why nothing overwrites the caller's value.
//
// `cf-connecting-ip` is the one header a caller cannot influence, and the measurement was stronger
// than "Cloudflare overwrites it": a request that CARRIES the header is rejected at the edge with
// 403 error 1000 and never reaches the Worker at all. Confirmed on BOTH surfaces — the throwaway
// echo Worker's workers.dev host and the production custom domain (403 with the header, 200
// without) — because the whole fix rests on it and workers.dev is not where the site serves.
// The same echo Worker measured the alternatives: x-forwarded-for and true-client-ip both arrive
// verbatim from the caller — so true-client-ip, an Enterprise-only feature this plan does not have,
// would be no fix at all — while x-real-ip is overwritten.
//
// NO FALLBACK LIST, deliberately. `getIp` walks `ipAddressHeaders` IN ORDER and takes the first that
// resolves, so appending x-forwarded-for behind this one would re-open the forgeable path in exactly
// the case that matters — an environment where the trustworthy header went missing. One header means
// an unresolvable address yields no bucket key rather than a caller-chosen one.
export const CLIENT_IP_HEADER = 'cf-connecting-ip';

// Behavioral, NOT schema-affecting (it changes which header is read, not what is stored), so — like
// `session` below and unlike `rateLimit` — this stays OUT of the CLI config (auth-cli.ts).
export const advanced = {
	ipAddress: {
		ipAddressHeaders: [CLIENT_IP_HEADER]
	}
};

// DAR-131: the two deployed Cloudflare Workers, named ONCE.
//
// The preview environment is a SEPARATE Worker rather than a mode of the production one, and that is
// forced rather than stylistic: secrets are per-Worker, and a Cloudflare preview URL is a *version*
// of a Worker, so anything uploaded as a version of production inherits production's secrets — and
// therefore the production database. Two Workers is what buys the dev-DB split; see
// docs/deployment.md → "Environments & databases".
//
// `wrangler.jsonc` has to spell both names out again, because it is what wrangler itself reads. That
// second copy is unavoidable, so `preview-worker.spec.ts` pins the two files against each other —
// the `preview-port.spec.ts` situation, where one half of a rule lives outside TypeScript's reach.
export const PROD_WORKER_NAME = 'darcstar-technologies-website';
export const PREVIEW_WORKER_NAME = `${PROD_WORKER_NAME}-preview`;

/**
 * A Worker's own `workers.dev` origin — and therefore the value its `ORIGIN` var has to carry.
 *
 * Load-bearing for the preview Worker specifically: better-auth's `isAuthPath()` mounts `/api/auth/*`
 * only for requests whose origin matches `baseURL` (= `ORIGIN`), so an `ORIGIN` that is not the
 * Worker's own host leaves the auth API answering 404 on the only surface that was provisioned to
 * exercise it. That is DAR-81's failure mode, and it is what the spec's ORIGIN assertion exists for.
 */
export const workersDevOrigin = (worker: string) => `https://${worker}.darcstar.workers.dev`;

// Cloudflare `workers.dev` origins trusted for auth (CSRF / cookie origin checks). `ORIGIN` itself is
// trusted automatically, so these cover the OTHER hosts each Worker answers on: its bare alias (an
// exact match, so it needs the scheme) and its per-version / per-branch preview URLs (`*` matches the
// prefix; a host pattern is matched against the hostname, so no scheme).
//
// DERIVED from the names above rather than typed out, because the preview Worker's hosts do NOT match
// the production `*-…-website.` pattern — they end `-website-preview.` — which is the kind of
// near-miss that reads as already covered and isn't.
export const trustedOrigins = [PROD_WORKER_NAME, PREVIEW_WORKER_NAME].flatMap((worker) => [
	workersDevOrigin(worker),
	`*-${worker}.darcstar.workers.dev`
]);

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
