import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';
import { emailAndPassword, rateLimit, session } from '$lib/server/auth-options';
import { parseAdminIds } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';

function createAuth() {
	// Secrets/vars are read per-request from platform.env (see readEnv). `getRequestEvent`
	// is still imported below for the sveltekitCookies plugin.
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
			'*-darcstar-technologies-website.darcstar.workers.dev'
		],
		database: drizzleAdapter(getDb(), { provider: 'sqlite' }),
		emailAndPassword, // #48: sign-up disabled — see auth-options.ts
		rateLimit, // #69: DB-backed limiter on the now-public auth endpoints — see auth-options.ts
		session, // cookie-cache the session so signed-in page views skip the DB — see auth-options.ts
		plugins: [
			// Operator-roster management (list/create/update/delete/reset-password/force-logout +
			// ban). `adminUserIds` is the owner bootstrap: those ids are treated as admins before any
			// role check (has-permission.mjs), so the owner can't be locked out with a null role.
			// Behavioral/env-dependent, so it lives here, not in auth-options.ts — but the plugin is
			// SCHEMA-affecting (adds user.role/banned/… + session.impersonatedBy), so it's mirrored
			// (bare) into auth-cli.ts. New accounts default to `user` (a plain operator).
			admin({
				adminUserIds: parseAdminIds(readEnv('ADMIN_USER_IDS')),
				defaultRole: 'user'
			}),
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
