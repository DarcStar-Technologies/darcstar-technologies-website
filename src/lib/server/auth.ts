import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';

function createAuth() {
	return betterAuth({
		baseURL: ORIGIN,
		secret: BETTER_AUTH_SECRET,
		// Cloudflare preview deployments get per-version workers.dev URLs; trust
		// them so auth (CSRF / cookie origin checks) works on previews. Production
		// (ORIGIN) is trusted automatically. `*` matches the version/branch prefix.
		trustedOrigins: ['*-darcstar-technologies-website.darcstar.workers.dev'],
		database: drizzleAdapter(getDb(), { provider: 'sqlite' }),
		emailAndPassword: { enabled: true },
		plugins: [
			sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
		]
	});
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * Lazily-created Better Auth instance (singleton). Deferred so module load
 * doesn't touch the database or env; created on first request, when the
 * Worker's secrets are available.
 */
export function getAuth() {
	return (instance ??= createAuth());
}
