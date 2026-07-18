import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';
import { emailAndPassword } from '$lib/server/auth-options';

function createAuth() {
	// Per-request Cloudflare env (secrets/vars); process.env fallback for dev.
	const cfEnv = getRequestEvent().platform?.env;
	return betterAuth({
		baseURL: cfEnv?.ORIGIN ?? process.env.ORIGIN,
		secret: cfEnv?.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
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
