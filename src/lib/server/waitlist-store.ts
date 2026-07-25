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

// Two enrich policies. They differ ONLY when both the stored value and a new value are present:
//
// keepExisting = `coalesce(<new>, <existing>)` — the PROVIDED value wins; a blank (null, since the
// validator nulls empties) keeps what's stored. Used by the token-gated qualification steps
// (applyWaitlistStep): possessing the continuation token authorizes updating a field you re-enter,
// and a sparser resubmit still never erases.
function keepExisting(next: string | null, column: string) {
	return sql`coalesce(${next}, ${sql.raw(column)})`;
}

// fillIfEmpty = `coalesce(<existing>, <new>)` — the STORED value wins; the new value only lands in a
// still-null column. Used by the step-1 upsert enrich (upsertWaitlist), which carries NO token: an
// anonymous re-submit of a known email can fill gaps but must never OVERWRITE a stored value, so a
// stranger who knows an existing address can't clobber that row's name/company/region. Enrich is also
// throttle-exempt (it adds no row for the per-IP row-count check to see), so overwrite-on-resubmit
// would otherwise be an unbounded vandalism vector. The FIRST write (insert) still sets every field;
// only later same-email collisions are held fill-forward.
function fillIfEmpty(next: string | null, column: string) {
	return sql`coalesce(${sql.raw(column)}, ${next})`;
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
	// Consent is an UNVERIFIED claim (this is single-opt-in from an unauthenticated form — a third
	// party can submit anyone's address), so it must NOT drive a real send without double-opt-in +
	// unsubscribe. We record the grant plus the moment it was first made (consent_updates_at) as the
	// provenance a compliance review needs; updated_at is clobbered by later step writes, so consent
	// keeps its own timestamp.
	const grantsConsent = sub.consentUpdates;

	// Bounded to two passes. Normal case: pass 1 either inserts (new) or enriches (existing). The
	// second pass exists ONLY for a genuine delete race — the conflicting row vanished between our
	// insert attempt and the enrich — where a fresh insert then wins. It can't spin: the enrich is
	// keyed on lower(email) (matching the functional unique index the insert conflicts on), so a
	// stored value in any case can't make the conflict fire yet the update miss.
	for (let attempt = 0; attempt < 2; attempt++) {
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
				consentUpdatesAt: grantsConsent ? DB_NOW : null,
				qualificationStep: 1,
				ipHash,
				userAgent
			})
			.onConflictDoNothing()
			.returning({ id: waitlist.id });

		if (inserted.length > 0) return { isNew: true, id: inserted[0].id };

		// Already on the list — enrich in place, FILL-FORWARD: fillIfEmpty only fills still-null
		// columns and never overwrites a stored value, so a stranger who knows an existing email
		// can't clobber the row's name/company/region via an (unauthenticated, throttle-exempt)
		// resubmit. updated_at bumps on the same clock as the DB default.
		// Consent is MONOTONIC: max(existing, new) — an unchecked box on a re-submit is "no new grant",
		// not a revocation (revoking is a deliberate future mechanism, e.g. an unsubscribe link). The
		// timestamp is set only on the FIRST grant (coalesce keeps an existing one).
		const enriched = await db
			.update(waitlist)
			.set({
				name: fillIfEmpty(sub.name, 'name'),
				company: fillIfEmpty(sub.company, 'company'),
				role: fillIfEmpty(sub.role, 'role'),
				companySize: fillIfEmpty(sub.companySize, 'company_size'),
				interest: fillIfEmpty(sub.interest, 'interest'),
				hearAbout: fillIfEmpty(sub.hearAbout, 'hear_about'),
				phone: fillIfEmpty(sub.phone, 'phone'),
				countryRegion: fillIfEmpty(sub.countryRegion, 'country_region'),
				consentUpdates: sql`max(consent_updates, ${grantsConsent ? 1 : 0})`,
				consentUpdatesAt: grantsConsent
					? sql`coalesce(consent_updates_at, ${DB_NOW})`
					: sql`consent_updates_at`,
				// Enrich is a step-1 action; coalesce floors a pre-v2 (null) row at 1 and never rewinds.
				qualificationStep: sql`coalesce(qualification_step, 1)`,
				updatedAt: DB_NOW
			})
			.where(sql`lower(${waitlist.email}) = ${email}`)
			.returning({ id: waitlist.id });

		if (enriched.length > 0) return { isNew: false, id: enriched[0].id };
		// else: the row vanished between insert and enrich — loop once; the retry's insert wins.
	}

	// Both passes conflicted-then-missed: not a transient race but a real invariant violation
	// (a unique index that doesn't match its own lower(email) key). Fail loudly rather than spin.
	throw new Error('upsertWaitlist did not converge: insert conflicted but enrich matched no row');
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
				// Tri-state (validator gates it on a positive pilot answer): a boolean is the real
				// answer and writes absolutely (an explicit decline after a stale "yes" must stick); a
				// null means the question wasn't shown → keep-existing, so a not-shown submit can't
				// silently revoke a standing grant.
				contactPermission: data.contactPermission ?? sql`contact_permission`,
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
