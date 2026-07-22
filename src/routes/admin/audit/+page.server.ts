import { desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { loginAudit } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

// Read-only login-audit view. Gated by the /admin `+layout.server.ts` guard (isStaff) — there are no
// form actions here, so no per-action re-check is needed (unlike the submissions delete). Like the
// submissions view this is a triage window, not an archive: cap the read; pagination is a follow-up.
const AUDIT_LIMIT = 200;

export const load: PageServerLoad = async () => {
	// getDb() reads platform.env via getRequestEvent(), so it must run before the first await.
	const db = getDb();
	const attempts = await db
		.select({
			id: loginAudit.id,
			email: loginAudit.email,
			success: loginAudit.success,
			reason: loginAudit.reason,
			status: loginAudit.status,
			ipAddress: loginAudit.ipAddress,
			userAgent: loginAudit.userAgent,
			createdAt: loginAudit.createdAt
		})
		.from(loginAudit)
		.orderBy(desc(loginAudit.createdAt))
		.limit(AUDIT_LIMIT);

	return { attempts, limit: AUDIT_LIMIT };
};
