import { desc } from 'drizzle-orm';
import { redirect, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';
import { getAuth } from '$lib/server/auth';
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
	// Clears the session cookie via the sveltekitCookies plugin, then back to the login page. The
	// guard (+layout.server.ts) then keeps them out until they sign in again.
	signout: async ({ request }) => {
		await getAuth().api.signOut({ headers: request.headers });
		redirect(303, '/login');
	}
};
