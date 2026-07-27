// Waitlist DB writes — extracted from the remotes (waitlist.remote.ts, waitlist-steps.remote.ts) so
// they're testable against an in-memory libsql client (waitlist-store.spec.ts) without a request
// context.
//
// APPEND-ONLY SINCE DAR-88. Every signup INSERTS a submission; a repeat email is a new row under the
// same lead, never an edit of the old one. The previous shape was insert-or-enrich, and collapsing two
// submitters onto one row is what created every write-policy question this module used to answer:
// DAR-59's keepExisting/fillIfEmpty split, DAR-72's actionable/judgement taxonomy, and the
// decline-wins consent rule all existed because two people could write one column. They can't now, so
// there is exactly ONE rule left (provided-wins, below) and it is a UX nicety rather than a security
// boundary — see the note above applyWaitlistStep.
//
// The two writes and what each is for:
//
//   insertWaitlistSubmission — upserts the LEAD (the collated person, one row per email) and then
//   always inserts a SUBMISSION under it. Returns `isNew` for the caller's email gate and the
//   submission `id` the continuation token binds to.
//
//   applyWaitlistStep — the ONLY write path for the optional steps 2–4, keyed strictly by submission
//   id (the caller resolves it from a verified token), building each step's SET clause from an
//   explicit per-step column list. The token now addresses the row ITS OWN submitter created, so a
//   step can only ever edit the answers that submitter gave.
import { and, eq, sql } from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { waitlistLead, waitlistSubmission } from './db/schema';
import type {
	CleanedWaitlist,
	CleanedWaitlistStep2,
	CleanedWaitlistStep3,
	CleanedWaitlistStep4A,
	CleanedWaitlistStep4B
} from './waitlist';

// ONE enrich rule, in three encodings (scalar / JSON array / tri-state flag). All of them are
// `coalesce(<new>, <existing>)` — the PROVIDED value wins, and a blank (null, since the validators
// null empties) keeps whatever stands, so a sparser resubmit of the same step never erases an earlier
// answer.
//
// Note what this is NOT any more. Before DAR-88 the policy per column was an AUTHORIZATION decision,
// because the row it wrote could belong to someone else: the continuation token reaches any submitter
// of a known address (step 1's anti-enumeration response hands it over), so `fillIfEmpty` guarded the
// one contact DESTINATION a step could write and `grantFillsDeclineWins` guarded the flag that grants
// permission to use it. Append-only removes the premise — a token addresses the submission its own
// holder created — so both are gone, and provided-wins applies uniformly. Nothing here defends a
// column from a stranger; the table shape does.
function keepExisting(next: string | number | null, column: string) {
	return sql`coalesce(${next}, ${sql.raw(column)})`;
}

// JSON-array encoding: drizzle's json mapping doesn't apply inside raw SQL, so serialize here.
function keepExistingJson(next: string[] | null, column: string) {
	return keepExisting(next === null ? null : JSON.stringify(next), column);
}

// Tri-state boolean encoding (contact_permission): null = the question wasn't shown, so keep what
// stands; false = an explicit decline; true = a grant. Bound as 0/1 rather than a JS boolean so the
// value reaching SQLite doesn't depend on driver boolean coercion.
function keepExistingFlag(next: boolean | null, column: string) {
	return keepExisting(next === null ? null : next ? 1 : 0, column);
}

const DB_NOW = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

// ---------------------------------------------------------------------------------------------
// Step-write budget (DAR-68). Steps 2–4 are unauthenticated writes authorized only by the
// continuation token, and the step-1 throttle can't see them: it counts ROWS created per hashed IP,
// and a step adds no row. So a token holder could drive unbounded UPDATEs at one row.
//
// DAR-88 narrowed the threat but did not remove it. The row a token addresses is now the submission
// its own holder created, so this no longer stands between an attacker and someone else's data — it
// simply bounds how much write traffic one submission can absorb. Kept for that, unchanged.
//
// The bound is a WHERE predicate on the UPDATE `applyWaitlistStep` was already going to make, with
// the counter kept in two columns on the row itself. Three properties follow from that, and each is
// the reason for it:
//
//   NO EXTRA QUERY. A permitted step costs exactly what it cost before; a refused one costs one
//   UPDATE that matches zero rows, which is strictly LESS than the write it replaces. A counter
//   table would invert that — spending a read and a write to refuse a write is protecting the
//   database by hammering it, and the refusals get more expensive precisely when abuse gets worse.
//
//   NO ORACLE, STRUCTURALLY. The ticket's constraint is that a throttle must not become a token
//   validity oracle. There is no code path here that could leak one: the guard is not a check that
//   runs before the write and returns a verdict, it IS the write, so nothing branches on it and
//   nothing can be surfaced. In the RESPONSE — the only thing a caller sees — a refused step, a
//   decoy token, an expired token, a deleted row and a successful write are one generic success.
//
//   NOTHING IS LOST. A refusal drops one enrichment, never a signup: the row was persisted at step
//   1 and these columns are optional extras.
//
// Still NOT bounded here, deliberately: request VOLUME (a refused POST still costs a round trip, and
// an attacker holding N tokens gets N budgets) — volumetric defense belongs at the edge, where it
// can't be sidestepped by rotating tokens.

/** Window length for the per-row step-write budget. */
export const WAITLIST_STEP_WRITE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Step writes allowed per submission per window.
 *
 * Deliberately far above a real visitor's ceiling rather than snug against it. The whole flow is
 * three writes (step 2 → 3 → a step-4 branch), so even someone who walks back through every step
 * correcting answers several times stays well underneath — which matters because the refusal is
 * SILENT, so a cap tight enough to catch a legitimate user would eat their answers with no error and
 * no way to tell. A generous cap still turns "unbounded" into a fixed small number, which is the
 * entire ask; buying a tighter one with silent data loss would be a bad trade.
 */
export const WAITLIST_STEP_WRITE_MAX = 20;

// Start of the current window, on the DB clock. Both the predicate and the stamp derive from this
// one expression, so the comparison and the value it writes can never come from different clocks.
const STEP_WINDOW_START = sql`(${DB_NOW} - ${WAITLIST_STEP_WRITE_WINDOW_MS})`;

// True when the row's window is still live. Null (never step-written) is false, so the else-branch of
// each CASE below opens a fresh window — no backfill needed.
const IN_WINDOW = sql`(step_write_window_at > ${STEP_WINDOW_START})`;

/**
 * Record one waitlist signup.
 *
 * ALWAYS INSERTS a submission — that is the DAR-88 change, and the reason the rest of this module got
 * simpler. What it upserts is the LEAD: one row per email, case-insensitively, which is the collated
 * person the submissions hang off.
 *
 * Returns:
 *
 *   `id`     — the SUBMISSION id. The continuation token binds to it, so steps 2–4 address the row
 *              this submitter just created and nothing else. (Pre-DAR-88 the token could be minted
 *              against a row someone ELSE created, since a repeat email resolved to their row; that
 *              is the exposure this removes.)
 *
 *   `isNew`  — "we had never seen this email before". LOAD-BEARING: the caller sends the welcome/ack
 *              emails only when it's true, and that gate is the mailbomb guard. Without it, a replay
 *              of a known address would mail the ack at whatever third party a script typed in, plus
 *              flood info@ — and the per-IP throttle can't catch that shape on its own.
 *
 *              It is derived from `insert … onConflictDoNothing().returning()` on the lead, so the
 *              DATABASE decides it atomically against the unique index, exactly as the old
 *              insert-vs-conflict did. Two concurrent first-signups for one address therefore cannot
 *              both be new — which a "count the submissions for this email" implementation would get
 *              wrong under a race, and which is why the gate rides the lead insert rather than a
 *              separate lookup.
 *
 * Email is lowercased HERE, not just in the validator: the lead's conflict check matches
 * case-insensitively (functional index), so the fallback SELECT must key the same way or a
 * mixed-case value could conflict yet find no row.
 */
export async function insertWaitlistSubmission(
	db: Db,
	sub: CleanedWaitlist,
	ipHash: string,
	userAgent: string | null
): Promise<{ isNew: boolean; id: string }> {
	const email = sub.email.toLowerCase();

	// Resolve the lead first. Bounded to two passes, and the shape mirrors the old upsert's: pass 1
	// either inserts (first time we've seen this address) or conflicts and reads the existing lead.
	// The second pass exists ONLY for a genuine delete race — the conflicting lead vanished between
	// our insert attempt and the read — where a fresh insert then wins. It can't spin: the read is
	// keyed on lower(email), matching the functional unique index the insert conflicts on, so a
	// stored value in any case can't make the conflict fire yet the read miss.
	let leadId: string | undefined;
	let isNew = false;
	for (let attempt = 0; attempt < 2 && leadId === undefined; attempt++) {
		const inserted = await db
			.insert(waitlistLead)
			.values({ email })
			.onConflictDoNothing()
			.returning({ id: waitlistLead.id });

		if (inserted.length > 0) {
			leadId = inserted[0].id;
			isNew = true;
			break;
		}

		const existing = await db
			.select({ id: waitlistLead.id })
			.from(waitlistLead)
			.where(sql`lower(${waitlistLead.email}) = ${email}`)
			.limit(1);
		if (existing.length > 0) leadId = existing[0].id;
		// else: the lead vanished between insert and read — loop once; the retry's insert wins.
	}

	if (leadId === undefined) {
		// Both passes conflicted-then-missed: not a transient race but a real invariant violation
		// (a unique index that doesn't match its own lower(email) key). Fail loudly rather than spin.
		throw new Error(
			'waitlist lead did not converge: insert conflicted but the read matched no row'
		);
	}

	// The submission itself. Unconditional — there is no enrich branch any more, which is why nothing
	// below needs a policy: every value here is what THIS submitter typed, in a row only they can
	// reach.
	//
	// Not in a transaction with the lead above, deliberately: the two writes are ordered (the FK needs
	// the lead first) and the only failure they can produce is a lead with no submissions, which the
	// admin view renders and an operator can delete. The cost of that window is that `isNew` was spent,
	// so a retry after this throw sends no welcome email — a dropped ack, which is the direction to
	// fail in. A transaction would trade that for Turso round trips on every signup.
	//
	// Consent is recorded per submission with its own timestamp (and the row's own ip_hash beside it),
	// which is better compliance evidence than the monotonic flag it replaces. It remains an UNVERIFIED
	// claim — unauthenticated single-opt-in, so a third party can submit anyone's address — and must
	// NOT drive a real send without double-opt-in + unsubscribe.
	const inserted = await db
		.insert(waitlistSubmission)
		.values({
			leadId,
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
			consentUpdatesAt: sub.consentUpdates ? DB_NOW : null,
			qualificationStep: 1,
			ipHash,
			userAgent
		})
		.returning({ id: waitlistSubmission.id });

	return { isNew, id: inserted[0].id };
}

/** One optional step's validated payload, tagged so the SET clause is a closed per-step map. */
export type WaitlistStepData =
	| ({ step: 2 } & CleanedWaitlistStep2)
	| ({ step: 3 } & CleanedWaitlistStep3)
	| ({ step: '4a' } & CleanedWaitlistStep4A)
	| ({ step: '4b' } & CleanedWaitlistStep4B);

/** qualification_step is monotonic: a revisit to an earlier step never rewinds the high-water mark. */
const stepRank = { 2: 2, 3: 3, '4a': 4, '4b': 4 } as const;

// ---------------------------------------------------------------------------------------------
// What a token holder may write (DAR-88 settles this).
//
// The old answer took three helpers and a per-column taxonomy, because the premise was that a token
// might address a row someone else created — step 1 returns the identical success shape, token
// included, for a new and an existing email, so the token reached ANY submitter of a known address.
// DAR-72 tightened `phone` and `contact_permission` under that premise; the premise itself is now
// gone. A signup always inserts, so a token binds to the submission its holder just made, and the
// worst a holder can do is edit their own answers.
//
// So the per-step column maps below are no longer an authorization boundary — but they STAY, for the
// two things they still do. They keep a step from writing another step's answers or the identity
// fields (email/name are in no step's map), which keeps a crafted POST from turning the enrich into a
// general-purpose row editor; and they keep each step's contract legible next to the validator that
// produces it. What changed is the reasoning required to add a column: it used to be "who else could
// write this, and what could they do with it", and it is now just "does this step ask that question".
//
// Poisoning did not disappear, it MOVED — and moved somewhere better. A stranger who submits a known
// address still gets a row with their own made-up answers under that person's lead. It is now an
// additional submission an operator can see, compare and discard, rather than an invisible edit of the
// real one, and the per-IP row-count throttle finally counts it. Judgement about which submission to
// believe is a human's, which is the whole point of holding leads for review.

/**
 * Apply one optional step to an existing submission (id comes from a VERIFIED continuation token —
 * this function trusts its caller on that and enforces everything else). Explicit per-step SET objects
 * keep a step to its own columns; every column is provided-wins, so a blank never erases.
 *
 * Returns `updated: false` when the id matches no row (deleted, or a decoy token minted for the
 * honeypot path) — callers respond with the same generic success either way, so this is not an
 * existence oracle. Since DAR-68 it also returns false when the row has spent its step-write budget
 * for the window, which is deliberately the SAME answer: a throttle that could be told apart from a
 * missing row would be exactly the oracle the budget is required not to be.
 */
export async function applyWaitlistStep(
	db: Db,
	id: string,
	data: WaitlistStepData
): Promise<{ updated: boolean }> {
	let set: SQLiteUpdateSetSource<typeof waitlistSubmission>;
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
				// Tri-state: null = the question wasn't on screen (the pilot answer wasn't positive), so
				// keep what stands rather than recording a decline nobody made.
				contactPermission: keepExistingFlag(data.contactPermission, 'contact_permission'),
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
		.update(waitlistSubmission)
		.set({
			...set,
			qualificationStep: sql`max(coalesce(qualification_step, 1), ${stepRank[data.step]})`,
			// Spend one unit of the window's budget. SQLite evaluates every SET expression against the
			// PRE-update row, so these two read the counter they are replacing.
			stepWriteCount: sql`case when ${IN_WINDOW} then coalesce(step_write_count, 0) + 1 else 1 end`,
			// Fixed window: a write inside a live one leaves the start where it is, so the window can't
			// be walked forward indefinitely by writing at its edge.
			stepWriteWindowAt: sql`case when ${IN_WINDOW} then step_write_window_at else ${DB_NOW} end`,
			updatedAt: DB_NOW
		})
		.where(
			and(
				eq(waitlistSubmission.id, id),
				// The budget check (DAR-68), as a predicate rather than a prior query — see the block
				// comment above WAITLIST_STEP_WRITE_MAX. Expired or never-opened window ⇒ allowed (and the SET
				// above opens a fresh one); otherwise allowed only while the count is under the cap.
				sql`(not ${IN_WINDOW} or coalesce(step_write_count, 0) < ${WAITLIST_STEP_WRITE_MAX})`
			)
		)
		.returning({ id: waitlistSubmission.id });

	return { updated: updated.length > 0 };
}
