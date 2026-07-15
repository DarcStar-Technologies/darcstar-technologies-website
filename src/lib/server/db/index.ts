import { drizzle } from 'drizzle-orm/libsql/web';
import { createClient } from '@libsql/client/web';
import * as schema from './schema';
import { DATABASE_URL, DATABASE_AUTH_TOKEN } from '$app/env/private';

function createDb() {
	if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
	if (!DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');
	return drizzle(createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN }), {
		schema
	});
}

let instance: ReturnType<typeof createDb> | undefined;

/**
 * Lazily-created Drizzle client (singleton). Deferred so importing this module —
 * e.g. during SvelteKit's build analyse pass — doesn't construct the libSQL
 * client (which throws without a valid DATABASE_URL). Created on first use at
 * runtime, when the Worker's secrets are available.
 */
export function getDb() {
	return (instance ??= createDb());
}
