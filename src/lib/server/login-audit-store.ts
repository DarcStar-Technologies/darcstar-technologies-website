// Env-bound persistence for the login audit (see auth-audit.ts for the pure hook). Kept separate so
// auth-audit.ts stays unit-testable without pulling in $app/server or the DB client. Called from the
// Better Auth after-hook (via injection in auth.ts) and from the /login action's 429 branch.
import { getRequestEvent } from '$app/server';
import { getDb } from '$lib/server/db';
import { loginAudit } from '$lib/server/db/schema';
import type { LoginAuditRecord } from '$lib/server/auth-audit';

/**
 * Write one audit row. Fire-and-forget: it never blocks the sign-in response and never throws — a DB
 * failure is logged and swallowed (the sign-in must still succeed/fail on its own merits). On workerd
 * the insert is registered with `platform.ctx.waitUntil` so the isolate stays alive until it resolves
 * after the response (the pattern in contact.remote.ts); in vite dev there's no ctx and the floating
 * promise simply runs (Node doesn't cancel it), so local rows still land.
 */
export function persistLoginAudit(record: LoginAuditRecord): void {
	// getDb() reads request-scoped platform.env via getRequestEvent(); resolve it synchronously,
	// before scheduling, so it isn't read after the response is sent.
	let db: ReturnType<typeof getDb>;
	try {
		db = getDb();
	} catch (err) {
		console.error('[auth] login audit skipped (no db)', err);
		return;
	}

	const write = (async () => {
		try {
			await db.insert(loginAudit).values({
				email: record.email,
				userId: record.userId,
				success: record.success,
				reason: record.reason,
				status: record.status,
				ipAddress: record.ipAddress,
				userAgent: record.userAgent
			});
		} catch (err) {
			console.error('[auth] login audit insert failed', err);
		}
	})();

	try {
		getRequestEvent().platform?.ctx?.waitUntil(write);
	} catch {
		// getRequestEvent() out of a request context — the floating `write` above still runs.
	}
}
