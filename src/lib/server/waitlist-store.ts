// Waitlist DB write — extracted from the remote (waitlist.remote.ts) so it's testable against an
// in-memory libsql client (waitlist-store.spec.ts) without a request context.
//
// The shape is insert-OR-enrich, and it reports which happened via `isNew`. That flag is
// load-bearing: the caller sends the welcome emails ONLY on a genuine new signup. Without it, a
// re-signup of the same email would re-mail on every submit — and because the IP/time throttle
// counts ROWS (and a re-signup UPSERTs rather than inserting a new row), same-email replays never
// trip the throttle, which would turn the ack into an unthrottled mailbomb aimed at any address an
// attacker types in (and a flood into info@). Gating emails on `isNew` closes that.
//
// v2 (DAR-59): upsertWaitlist also returns the row `id` (the continuation token binds to it), and
// applyWaitlistStep is the ONLY write path for the optional steps 2–4 — keyed strictly by id (the
// caller resolves it from a verified token), building each step's SET clause from an explicit
// per-step column list, so no later step can create a row or touch step-1 identity fields.
import { eq, sql } from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { waitlist } from './db/schema';
import type {
	CleanedWaitlist,
	CleanedWaitlistStep2,
	CleanedWaitlistStep3,
	CleanedWaitlistStep4A,
	CleanedWaitlistStep4B
} from './waitlist';

// `coalesce(<new>, <existing-column>)` — on enrich, a provided value wins; a blank (null, since the
// validator nulls empties) keeps whatever's already stored. So a returning user fills gaps / updates
// fields they re-enter, and never erases data by submitting a sparser form.
function keepExisting(next: string | null, column: string) {
	return sql`coalesce(${next}, ${sql.raw(column)})`;
}

// JSON-array twin of keepExisting: drizzle's json mapping doesn't apply inside raw SQL, so the
// array is serialized here. null (nothing valid selected) keeps the stored value — same
// never-erase posture as the scalars.
function keepExistingJson(next: string[] | null, column: string) {
	return keepExisting(next === null ? null : JSON.stringify(next), column);
}

const DB_NOW = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Insert a new signup, or enrich the existing row when this email is already on the list. Returns
 * `isNew` so the caller can gate the welcome emails on a genuine first signup, and `id` so it can
 * mint the continuation token for the optional steps.
 *
 * Race-free: `insert … onConflictDoNothing().returning()` lets the DB atomically decide insert vs.
 * conflict (the unique index is on `lower(email)`), so two concurrent first-signups can't both be
 * treated as new. `onConflictDoNothing()` takes no target — `waitlist` has a single unique
 * constraint, and the functional lower(email) index wouldn't match an `(email)` target anyway.
 *
 * Email is lowercased HERE, not just in the validator: the conflict check matches case-insensitively
 * (functional index), so the enrich UPDATE must key the same way or it would detect the conflict yet
 * silently update zero rows. Normalizing at the store boundary keeps both halves consistent and makes
 * the store self-defending regardless of how the caller normalized (the point of the lower(email) index).
 */
export async function upsertWaitlist(
	db: Db,
	sub: CleanedWaitlist,
	ipHash: string,
	userAgent: string | null
): Promise<{ isNew: boolean; id: string }> {
	const email = sub.email.toLowerCase();
	const inserted = await db
		.insert(waitlist)
		.values({
			email,
			name: sub.name,
			company: sub.company,
			role: sub.role,
			companySize: sub.companySize,
			interest: sub.interest,
			hearAbout: sub.hearAbout,
			phone: sub.phone,
			countryRegion: sub.countryRegion,
			consentUpdates: sub.consentUpdates,
			qualificationStep: 1,
			ipHash,
			userAgent
		})
		.onConflictDoNothing()
		.returning({ id: waitlist.id });

	if (inserted.length > 0) return { isNew: true, id: inserted[0].id };

	// Already on the list — enrich in place, bump updated_at (same clock as the DB default). Keyed on
	// the same normalized email as the insert, so the row the conflict matched is the row we update.
	// Consent is MONOTONIC here: max(existing, new) — an unchecked box on a re-submit is "no new
	// grant", not a revocation (revoking is a deliberate future mechanism, e.g. an unsubscribe link).
	const enriched = await db
		.update(waitlist)
		.set({
			name: keepExisting(sub.name, 'name'),
			company: keepExisting(sub.company, 'company'),
			role: keepExisting(sub.role, 'role'),
			companySize: keepExisting(sub.companySize, 'company_size'),
			interest: keepExisting(sub.interest, 'interest'),
			hearAbout: keepExisting(sub.hearAbout, 'hear_about'),
			phone: keepExisting(sub.phone, 'phone'),
			countryRegion: keepExisting(sub.countryRegion, 'country_region'),
			consentUpdates: sql`max(consent_updates, ${sub.consentUpdates ? 1 : 0})`,
			qualificationStep: sql`max(coalesce(qualification_step, 1), 1)`,
			updatedAt: DB_NOW
		})
		.where(eq(waitlist.email, email))
		.returning({ id: waitlist.id });

	if (enriched.length > 0) return { isNew: false, id: enriched[0].id };

	// The conflicting row vanished between the insert attempt and the enrich (an admin delete
	// racing a re-signup) — retry from the top; the fresh insert then wins.
	return upsertWaitlist(db, sub, ipHash, userAgent);
}

/** One optional step's validated payload, tagged so the SET clause is a closed per-step map. */
export type WaitlistStepData =
	| ({ step: 2 } & CleanedWaitlistStep2)
	| ({ step: 3 } & CleanedWaitlistStep3)
	| ({ step: '4a' } & CleanedWaitlistStep4A)
	| ({ step: '4b' } & CleanedWaitlistStep4B);

/** qualification_step is monotonic: a revisit to an earlier step never rewinds the high-water mark. */
const stepRank = { 2: 2, 3: 3, '4a': 4, '4b': 4 } as const;

/**
 * Apply one optional step to an existing row (id comes from a VERIFIED continuation token — this
 * function trusts its caller on that and enforces everything else). Explicit per-step SET objects
 * are the mass-assignment guard: a step can only ever write its own columns, never identity
 * (email/name/…) and never another step's answers. Same keep-existing semantics as the enrich path.
 *
 * Returns `updated: false` when the id matches no row (deleted, or a decoy token minted for the
 * honeypot path) — callers respond with the same generic success either way, so this is not an
 * existence oracle.
 */
export async function applyWaitlistStep(
	db: Db,
	id: string,
	data: WaitlistStepData
): Promise<{ updated: boolean }> {
	let set: SQLiteUpdateSetSource<typeof waitlist>;
	switch (data.step) {
		case 2:
			set = {
				role: keepExisting(data.role, 'role'),
				primaryApplication: keepExisting(data.primaryApplication, 'primary_application'),
				evaluationTimeline: keepExisting(data.evaluationTimeline, 'evaluation_timeline')
			};
			break;
		case 3:
			set = {
				currentApproach: keepExisting(data.currentApproach, 'current_approach'),
				economicImpact: keepExisting(data.economicImpact, 'economic_impact'),
				budgetRange: keepExisting(data.budgetRange, 'budget_range'),
				adoptionEvidence: keepExistingJson(data.adoptionEvidence, 'adoption_evidence')
			};
			break;
		case '4a':
			set = {
				pilotInterest: keepExisting(data.pilotInterest, 'pilot_interest'),
				deploymentScale: keepExisting(data.deploymentScale, 'deployment_scale'),
				// Not keep-existing: this step IS the question, so the submitted state is the answer
				// (declining after a stale earlier "yes" must stick).
				contactPermission: data.contactPermission,
				contactMethod: keepExisting(data.contactMethod, 'contact_method'),
				phone: keepExisting(data.phone, 'phone')
			};
			break;
		case '4b':
			set = {
				researchPreferences: keepExistingJson(data.researchPreferences, 'research_preferences')
			};
			break;
	}

	const updated = await db
		.update(waitlist)
		.set({
			...set,
			qualificationStep: sql`max(coalesce(qualification_step, 1), ${stepRank[data.step]})`,
			updatedAt: DB_NOW
		})
		.where(eq(waitlist.id, id))
		.returning({ id: waitlist.id });

	return { updated: updated.length > 0 };
}
