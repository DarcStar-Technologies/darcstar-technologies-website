import { drizzle } from 'drizzle-orm/libsql/web';
import { createClient } from '@libsql/client/web';
import * as schema from './schema';
import { readEnv } from '$lib/server/env';

function createDb() {
	// Secrets are read per-request from platform.env (see readEnv), never at module load.
	const url = readEnv('DATABASE_URL');
	const authToken = readEnv('DATABASE_AUTH_TOKEN');
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
