import { desc, eq } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { waitlist } from '$lib/server/db/schema';
import { isStaff } from '$lib/server/admin-access';
import { classifyWaitlistLead } from '$lib/server/waitlist-classify';
import { readEnv } from '$lib/server/env';
import {
	WAITLIST_LEAD_CLASSES,
	waitlistLeadClassRank,
	type WaitlistLeadClass
} from '$lib/waitlist-qualification';
import type { PageServerLoad } from './$types';

// Triage view of waitlist signups (sibling of /admin submissions). Reached only past the /admin route
// guard (../+layout.server.ts), so this inherits the isStaff gate. Cap the read — a triage list, not
// an archive; the UI notes when it's showing only the most recent slice.
const WAITLIST_LIMIT = 200;

/** `?class=` → a real lead class, or null for "no filter" (absent, or anything unrecognized). */
const asLeadClass = (value: string | null): WaitlistLeadClass | null =>
	value !== null && (WAITLIST_LEAD_CLASSES as readonly string[]).includes(value)
		? (value as WaitlistLeadClass)
		: null;

export const load: PageServerLoad = async ({ url }) => {
	// getDb() reads platform.env via getRequestEvent(), so it must run before the first await.
	const db = getDb();
	const rows = await db
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
			countryRegion: waitlist.countryRegion,
			consentUpdates: waitlist.consentUpdates,
			primaryApplication: waitlist.primaryApplication,
			evaluationTimeline: waitlist.evaluationTimeline,
			currentApproach: waitlist.currentApproach,
			economicImpact: waitlist.economicImpact,
			budgetRange: waitlist.budgetRange,
			adoptionEvidence: waitlist.adoptionEvidence,
			pilotInterest: waitlist.pilotInterest,
			deploymentScale: waitlist.deploymentScale,
			contactPermission: waitlist.contactPermission,
			contactMethod: waitlist.contactMethod,
			researchPreferences: waitlist.researchPreferences,
			qualificationStep: waitlist.qualificationStep,
			createdAt: waitlist.createdAt,
			updatedAt: waitlist.updatedAt
		})
		.from(waitlist)
		.orderBy(desc(waitlist.createdAt))
		.limit(WAITLIST_LIMIT);

	// Classification is COMPUTED ON READ, never stored (see waitlist-classify.ts): it's a pure
	// function of columns already here, so a denormalized copy would only add a migration and a
	// recompute obligation on every step write. `row` carries the money columns too — the classifier's
	// input type simply doesn't have them, which is the guardrail.
	const classified = rows.map((row) => ({ ...row, leadClass: classifyWaitlistLead(row) }));

	// Counts over the WHOLE window, before filtering, so the chips keep showing the full picture
	// while a filter is applied.
	const counts = Object.fromEntries(
		WAITLIST_LEAD_CLASSES.map((leadClass) => [
			leadClass,
			classified.filter((row) => row.leadClass === leadClass).length
		])
	) as Record<WaitlistLeadClass, number>;

	const filter = asLeadClass(url.searchParams.get('class'));
	const signups = (
		filter === null ? [...classified] : classified.filter((row) => row.leadClass === filter)
	)
		// Priority first so an A lead can't be buried under 199 newer subscribers. Array.sort is
		// stable, so the SQL's newest-first ordering survives as the within-band tiebreak.
		.sort((a, b) => waitlistLeadClassRank(a.leadClass) - waitlistLeadClassRank(b.leadClass));

	return { signups, counts, filter, total: classified.length, limit: WAITLIST_LIMIT };
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
