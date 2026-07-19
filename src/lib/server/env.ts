import { getRequestEvent } from '$app/server';

/**
 * Read a Worker secret/var. On Cloudflare these live in the **per-request** `platform.env` —
 * reads at module load (`$app/env/private`, top-level `process.env`) come back empty on
 * workerd — so this MUST be called inside a request. Falls back to `process.env` for local
 * dev (`.env`). Shared by `getDb()` and `getAuth()`; the lazy singletons there exist for the
 * same reason (env is only bound once a request is in flight).
 */
export function readEnv(key: keyof Env): string | undefined {
	const cfEnv = getRequestEvent().platform?.env;
	return (cfEnv?.[key] as string | undefined) ?? process.env[key];
}
