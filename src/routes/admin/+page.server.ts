import { desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';
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
