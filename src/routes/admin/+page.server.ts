import { desc, eq } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';
import { isStaff } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

// Triage view, not an archive — cap the read. Pagination is a later follow-up; when the list
// length equals this cap the UI notes it's showing only the most recent slice (admin_cap_note).
// Not exported: SvelteKit only allows its own reserved exports (+ `_`-prefixed) from a +page.server.
const SUBMISSIONS_LIMIT = 200;

export const load: PageServerLoad = async () => {
	// getDb() reads platform.env via getRequestEvent(), so it must run before the first await.
	const db = getDb();
	const submissions = await db
		.select({
			id: contactSubmission.id,
			name: contactSubmission.name,
			email: contactSubmission.email,
			company: contactSubmission.company,
			interest: contactSubmission.interest,
			message: contactSubmission.message,
			createdAt: contactSubmission.createdAt
		})
		.from(contactSubmission)
		.orderBy(desc(contactSubmission.createdAt))
		.limit(SUBMISSIONS_LIMIT);

	return { submissions, limit: SUBMISSIONS_LIMIT };
};

export const actions: Actions = {
	// Delete a submission — the "manage messages" capability (#95), available to staff (admin +
	// operator). SvelteKit does NOT run the layout guard before a form action (only on the re-render),
	// so authorize here; `readEnv` + `getDb` read request-scoped env, so call them before the first
	// await. Idempotent: a missing/already-deleted id is a no-op, and load re-runs on the re-render so
	// the row disappears.
	delete: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { error: 'forbidden' as const });
		}
		const db = getDb();
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing' as const });
		await db.delete(contactSubmission).where(eq(contactSubmission.id, id));
		return { ok: true as const };
	}
};
