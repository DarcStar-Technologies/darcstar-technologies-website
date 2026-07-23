import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, captcha } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';
import { emailAndPassword, rateLimit, session } from '$lib/server/auth-options';
import { parseAdminIds } from '$lib/server/admin-access';
import { createLoginAuditHook } from '$lib/server/auth-audit';
import { persistLoginAudit } from '$lib/server/login-audit-store';
import { linkSubmissionsToUser } from '$lib/server/contact-ownership';
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
	// Turnstile is all-or-nothing: enforcing needs the SECRET (server siteverify) AND the widget needs
	// the SITE key. With only ONE set, enforcing would dead-end sign-up (a required token with no widget
	// to mint it) or show a widget the server ignores — so a partial config counts as "captcha off"
	// (rate limiting + email verification still gate sign-up). The /signup load gates the widget on the
	// same pair, keeping "widget shown" ⟺ "captcha enforced".
	const turnstileSecret = readEnv('TURNSTILE_SECRET_KEY');
	const turnstileSiteKey = readEnv('TURNSTILE_SITE_KEY');
	const captchaActive = Boolean(turnstileSecret && turnstileSiteKey);
	if (Boolean(turnstileSecret) !== Boolean(turnstileSiteKey)) {
		console.warn(
			'[auth] Turnstile is half-configured — set BOTH TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY (or neither); captcha is DISABLED on sign-up until both are present'
		);
	}
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
		// #96 PR2: public sign-up re-opened behind verification+captcha — base config in auth-options.ts.
		// Augmented here with the env-bound password-reset sender (needs the Resend key), like
		// emailVerification below. `revokeSessionsOnPasswordReset` signs out all OTHER sessions on a
		// reset — recovering a compromised account must not leave an attacker signed in.
		emailAndPassword: {
			...emailAndPassword,
			resetPasswordTokenExpiresIn: 3600, // 1 hour — matches the verification token + the email copy
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
			}
		},
		rateLimit, // #69: DB-backed limiter on the now-public auth endpoints — see auth-options.ts
		session, // cookie-cache the session so signed-in page views skip the DB — see auth-options.ts
		// #96 (PR 2): verify the email before an account is usable (requireEmailVerification lives in
		// auth-options.ts). `sendOnSignUp` mails the link at registration; `autoSignInAfterVerification`
		// drops the visitor into /account (the callbackURL the /signup action passes) the moment they
		// click it; `afterEmailVerification` is the SAFE point to claim their historical contact
		// submissions — email ownership is now proven (reuses PR 1's linkSubmissionsToUser). Env-bound
		// (Resend key + DB), so it lives here, not in auth-options.ts.
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
			// #96 (PR 2): Cloudflare Turnstile on public sign-up ONLY. `endpoints` MUST stay scoped to
			// /sign-up/email — the plugin's defaults ALSO guard /sign-in/email + /request-password-reset,
			// which carry no widget and would break the no-JS /login. Registered only when the secret is
			// present, so dev without keys signs up challenge-free (graceful, like the Resend skip).
			// Behavioral (onRequest) → NOT mirrored to auth-cli.ts. Sits before sveltekitCookies (last).
			...(captchaActive
				? [
						captcha({
							provider: 'cloudflare-turnstile',
							secretKey: turnstileSecret as string,
							endpoints: ['/sign-up/email']
						})
					]
				: []),
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
