import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';
import { emailAndPassword, rateLimit } from '$lib/server/auth-options';
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
		plugins: [
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
