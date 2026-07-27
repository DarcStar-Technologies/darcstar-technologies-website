import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';
import {
	emailAndPassword,
	rateLimit,
	session,
	RESET_PASSWORD_TOKEN_TTL_SECONDS
} from '$lib/server/auth-options';
import { parseAdminIds } from '$lib/server/admin-access';
import { createLoginAuditHook } from '$lib/server/auth-audit';
import { persistLoginAudit } from '$lib/server/login-audit-store';
import { linkSubmissionsToUser } from '$lib/server/contact-ownership';
import { markWaitlistActivated } from '$lib/server/waitlist-invite';
import { sendVerificationEmail as sendVerificationMessage } from '$lib/server/verification-email';
import { sendPasswordResetEmail as sendPasswordResetMessage } from '$lib/server/password-reset-email';
import { baseLocale } from '$lib/paraglide/runtime';
import { readEnv } from '$lib/server/env';

function createAuth() {
	// Secrets/vars are read per-request from platform.env (see readEnv). `getRequestEvent`
	// is still imported below for the sveltekitCookies plugin.
	//
	// Hoisted env reads (#96, PR 2): createAuth runs once, on the FIRST request (getAuth is a lazy
	// singleton), so readEnv resolves here. The emailVerification callbacks + captcha plugin close
	// over these instead of re-reading env inside better-auth's async machinery — where the
	// SvelteKit request's AsyncLocalStorage context (which readEnv needs) may no longer be active.
	const resendKey = readEnv('RESEND_API_KEY');
	return betterAuth({
		baseURL: readEnv('ORIGIN'),
		secret: readEnv('BETTER_AUTH_SECRET'),
		// Trust the Cloudflare workers.dev origins for auth (CSRF / cookie origin
		// checks). Production (ORIGIN) is trusted automatically.
		// - bare production alias (exact match needs the scheme)
		// - per-version preview URLs (`*` matches the version/branch prefix; host
		//   form is matched against the hostname, so no scheme)
		trustedOrigins: [
			'https://darcstar-technologies-website.darcstar.workers.dev',
			'*-darcstar-technologies-website.darcstar.workers.dev',
			// Preview env Worker (wrangler.jsonc `[env.preview]`, non-prod branch deploys → the
			// DEV DB): its own bare workers.dev host + per-version preview URLs. The `*-…website`
			// pattern above does NOT cover these (they end in `-preview.…`), so list them too.
			'https://darcstar-technologies-website-preview.darcstar.workers.dev',
			'*-darcstar-technologies-website-preview.darcstar.workers.dev'
		],
		database: drizzleAdapter(getDb(), { provider: 'sqlite' }),
		// Base config (now `disableSignUp` — invite-only since DAR-67) in auth-options.ts. Augmented here
		// with the env-bound password-reset sender (needs the Resend key), like emailVerification below.
		// `revokeSessionsOnPasswordReset` signs out all OTHER sessions on a reset — recovering a
		// compromised account must not leave an attacker signed in.
		//
		// The reset flow carries more weight than its name suggests now: DAR-67's invitations are
		// password-reset tokens, so this is also the path by which every new account gets its first
		// password. Disabling reset would disable onboarding.
		emailAndPassword: {
			...emailAndPassword,
			// One constant so this, the reset email's "expires in one hour" copy and the verification
			// token's expiresIn below can't drift apart. NOTE it governs only what better-auth's own
			// `requestPasswordReset` stamps: DAR-67's invitations hand-mint their verification row with a
			// week-long expiry (ACTIVATION_TOKEN_TTL_SECONDS), and consumption honours the row rather
			// than this value — so raising or lowering this does NOT change how long an invitation lasts.
			resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_SECONDS,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) => {
				if (!resendKey) {
					// Graceful dev skip (no Resend), like the verification email: the token is still minted +
					// persisted, so log the reset link for a local dev to click. Never runs in prod (the key
					// is always set), so the token URL isn't logged there.
					console.warn(
						`[auth] password-reset email skipped (no RESEND_API_KEY) — reset link: ${url}`
					);
					return;
				}
				await sendPasswordResetMessage(
					resendKey,
					{ to: user.email, name: user.name, url },
					baseLocale
				);
			},
			// DAR-67: setting a password IS the activation event for an invited prospect, and this is the
			// only hook that sees it — /reset-password consumes the token through better-auth, which knows
			// nothing about the waitlist. Fires for EVERY reset, so the discrimination lives in the query:
			// `markWaitlistActivated` stamps only a row that was actually invited and isn't already
			// stamped (see waitlist-invite.ts). A routine reset by someone who was never invited matches
			// nothing and writes nothing.
			//
			// Best-effort and fully swallowed: this is a reporting timestamp, and failing someone's
			// password reset over it would be the tail wagging the dog. Awaited inline by the endpoint
			// (password.mjs), so we're still inside the SvelteKit request — `getDb()` resolves normally.
			onPasswordReset: async ({ user }) => {
				try {
					const stamped = await markWaitlistActivated(getDb(), user.email);
					if (stamped > 0) {
						// Pairs with the '[invite] activation.sent' line the invite action writes, so the two
						// ends of an onboarding are greppable together in Workers Logs.
						console.info('[invite] activation.completed', JSON.stringify({ email: user.email }));
					}
				} catch (err) {
					console.error('[invite] stamping the waitlist activation failed', err);
				}
			}
		},
		// #69: DB-backed limiter on the now-public auth endpoints — see auth-options.ts. Env-bound
		// here for the same reason the senders above are: only the STORE is chosen at runtime, and
		// only in a local preview.
		//
		// DAR-81: the limiter runs before every /api/auth route, so `storage: 'database'` makes a DB
		// round-trip the precondition for reaching any auth logic at all. The e2e suite is hermetic —
		// its DATABASE_URL is a placeholder that resolves to nothing — so with the shipped value every
		// auth endpoint answered 500 before better-auth decided anything, GET /ok included, and the
		// boundaries DAR-67 wanted asserted end-to-end stayed untestable. `pnpm preview` bakes
		// AUTH_RATE_LIMIT_STORAGE=memory (scripts/preview-vars.mjs) so the limiter still RUNS, just
		// without a database.
		//
		// FAIL-SAFE POLARITY, and it is the whole safety argument: weakening a rate limiter needs a
		// POSITIVE signal, so only the exact literal `memory` switches the store and everything else —
		// unset, blank, a typo, any other value — keeps the durable one. Nothing declares this var in
		// wrangler.jsonc, so no deployed Worker carries it. Memory storage on Cloudflare is per-isolate,
		// which is to say no limiter at all (auth-options.ts) — that is what must never ship, and what
		// this polarity makes take a deliberate act rather than a mistake.
		rateLimit: {
			...rateLimit,
			storage: readEnv('AUTH_RATE_LIMIT_STORAGE') === 'memory' ? 'memory' : 'database'
		},
		session, // cookie-cache the session so signed-in page views skip the DB — see auth-options.ts
		// #96 (PR 2): verify the email before an account is usable (requireEmailVerification lives in
		// auth-options.ts). `autoSignInAfterVerification` drops the visitor into /account the moment they
		// click the link; `afterEmailVerification` is the SAFE point to claim their historical contact
		// submissions — email ownership is now proven (reuses PR 1's linkSubmissionsToUser). Env-bound
		// (Resend key + DB), so it lives here, not in auth-options.ts.
		//
		// DAR-67 left this whole block in place even though invite-only onboarding creates accounts
		// ALREADY verified (staff vouch by typing the address), so nothing routes through it on the happy
		// path any more. It still serves the accounts that predate the lockdown: legacy self-registrants
		// who never clicked their link are unverified, still 403 at sign-in, and still need `sendOnSignIn`
		// plus the #115 resend affordance to get in. `sendOnSignUp` is now unreachable (there are no
		// sign-ups) and kept only so re-opening registration doesn't silently ship without it.
		emailVerification: {
			sendOnSignUp: true,
			// Re-send the link when an UNVERIFIED account tries to sign in (it still 403s). Recovery for a
			// user who ignored/lost the original link or let it expire and returns to /login: their attempt
			// mints a fresh link (the /login action surfaces the "verify your email" outcome). Safe: the
			// 403 fires only AFTER the password check passes, so this never mails a non-owner's inbox.
			sendOnSignIn: true,
			autoSignInAfterVerification: true,
			expiresIn: 3600, // 1 hour — matches the "expires in an hour" copy in the email + UI
			sendVerificationEmail: async ({ user, url }) => {
				if (!resendKey) {
					// Graceful skip (dev without Resend), like the contact emails: the token is still
					// minted + persisted, so log the verify link here — a local dev can click it to
					// complete verification without an inbox. This branch never runs in prod (the key is
					// always set), so the token URL isn't logged there.
					console.warn(
						`[auth] verification email skipped (no RESEND_API_KEY) — verify link: ${url}`
					);
					return;
				}
				await sendVerificationMessage(
					resendKey,
					{ to: user.email, name: user.name, url },
					baseLocale
				);
			},
			afterEmailVerification: async (user) => {
				// Best-effort ownership backfill: a link failure must not fail the verification.
				try {
					await linkSubmissionsToUser(getDb(), user.id, user.email);
				} catch (err) {
					console.error('[auth] linking submissions after verification failed', err);
				}
			}
		},
		// Login audit: record every sign-in attempt (success + failure) to `login_audit` + a server
		// log line. Fires for the /login form AND direct /api/auth/sign-in/email. Behavioral (adds no
		// table — the app-owned `login_audit` lives in db/schema.ts), so it's NOT mirrored in
		// auth-cli.ts. See auth-audit.ts / login-audit-store.ts. Rate-limit 429s are recorded by the
		// login action instead (the router rejects them before this hook runs).
		hooks: {
			after: createLoginAuditHook(persistLoginAudit)
		},
		plugins: [
			// Operator-roster management (list/create/update/delete/reset-password/force-logout +
			// ban). `adminUserIds` is the owner bootstrap: those ids are treated as admins before any
			// role check (has-permission.mjs), so the owner can't be locked out with a null role.
			// Behavioral/env-dependent, so it lives here, not in auth-options.ts — but the plugin is
			// SCHEMA-affecting (adds user.role/banned/… + session.impersonatedBy), so it's mirrored
			// (bare) into auth-cli.ts. New accounts default to `user` (an end-user, not staff).
			admin({
				adminUserIds: parseAdminIds(readEnv('ADMIN_USER_IDS')),
				// Only the `admin` role may call the admin API (roster management). Made explicit now that
				// `operator` (staff — reads/manages messages, not the roster) and `user` (dormant end-user,
				// #96) exist: neither is an admin role. This is the plugin default, but pinning it guards
				// against a future default change. Behavioral (not schema-affecting) → stays out of auth-cli.ts.
				adminRoles: ['admin'],
				// Applies to public sign-up (now live, #96 PR 2) — self-registrants default to `user`
				// (end-user, own account only). Roster-created staff pass an explicit role, so this never
				// makes an operator; the bootstrap script (create-admin.ts) sets `admin` directly.
				defaultRole: 'user'
			}),
			// DAR-67 REMOVED the Cloudflare Turnstile captcha plugin. It was scoped to exactly one
			// endpoint — POST /sign-up/email (#96 PR 2) — and that endpoint now rejects everything at the
			// router (`disableSignUp`, auth-options.ts), so the challenge guarded nothing. Keeping it would
			// have been worse than dead weight: its onRequest runs BEFORE the sign-up check, so a probe
			// would come back "solve the captcha" instead of "sign-up is disabled", which reads like a door
			// that opens for anyone patient enough.
			//
			// TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY stay in the env and the challenges.cloudflare.com
			// CSP allowlist stays in vite.config.ts, so re-opening public sign-up means re-adding this
			// plugin and a widget — not a secrets rotation and a CSP change. See docs/auth.md.
			sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
		]
	});
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * Lazily-created Better Auth instance (singleton). Env is read per-request from
 * getRequestEvent().platform.env; created on first request when the Worker's
 * secrets are available (see db/index.ts for why module-load env reads fail on
 * workerd).
 */
export function getAuth() {
	return (instance ??= createAuth());
}
