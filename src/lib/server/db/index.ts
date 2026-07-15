import { drizzle } from 'drizzle-orm/libsql/web';
import { createClient } from '@libsql/client/web';
import * as schema from './schema';
import { getRequestEvent } from '$app/server';

function createDb() {
	// On Cloudflare the Worker's secrets live in the per-request platform.env,
	// NOT in global process.env / `$app/env/private` (which read empty on
	// workerd). Fall back to process.env for local dev (`.env`).
	const cfEnv = getRequestEvent().platform?.env;
	const url = cfEnv?.DATABASE_URL ?? process.env.DATABASE_URL;
	const authToken = cfEnv?.DATABASE_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN;
	if (!url) throw new Error('DATABASE_URL is not set');
	if (!authToken) throw new Error('DATABASE_AUTH_TOKEN is not set');
	return drizzle(createClient({ url, authToken }), { schema });
}

let instance: ReturnType<typeof createDb> | undefined;

/**
 * Lazily-created Drizzle client (singleton). Env is read per-request from
 * getRequestEvent().platform.env, so this must be constructed inside a request
 * — hence the lazy singleton. Reading env at module load (via `$app/env/private`)
 * fails on workerd because the secrets are only bound per-request.
 */
export function getDb() {
	return (instance ??= createDb());
}
