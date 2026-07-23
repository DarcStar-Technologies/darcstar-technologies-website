import { desc, eq } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { waitlist } from '$lib/server/db/schema';
import { isStaff } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

// Triage view of waitlist signups (sibling of /admin submissions). Reached only past the /admin route
// guard (../+layout.server.ts), so this inherits the isStaff gate. Cap the read — a triage list, not
// an archive; the UI notes when it's showing only the most recent slice.
const WAITLIST_LIMIT = 200;

export const load: PageServerLoad = async () => {
	// getDb() reads platform.env via getRequestEvent(), so it must run before the first await.
	const db = getDb();
	const signups = await db
		.select({
			id: waitlist.id,
			email: waitlist.email,
			name: waitlist.name,
			company: waitlist.company,
			role: waitlist.role,
			companySize: waitlist.companySize,
			interest: waitlist.interest,
			hearAbout: waitlist.hearAbout,
			phone: waitlist.phone,
			createdAt: waitlist.createdAt
		})
		.from(waitlist)
		.orderBy(desc(waitlist.createdAt))
		.limit(WAITLIST_LIMIT);

	return { signups, limit: WAITLIST_LIMIT };
};

export const actions: Actions = {
	// Delete a signup — staff (admin + operator). SvelteKit does NOT run the layout guard before a
	// form action (only on the re-render), so authorize here; readEnv + getDb read request-scoped env,
	// so call them before the first await. Idempotent: a missing/already-deleted id is a no-op.
	delete: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { error: 'forbidden' as const });
		}
		const db = getDb();
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing' as const });
		await db.delete(waitlist).where(eq(waitlist.id, id));
		return { ok: true as const };
	}
};
