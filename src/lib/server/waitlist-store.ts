// Waitlist DB access — extracted from the remotes (waitlist.remote.ts, waitlist-steps.remote.ts) and
// from /admin/waitlist's load, so it's testable against an in-memory libsql client
// (waitlist-store.spec.ts) without a request context.
//
// APPEND-ONLY SINCE DAR-88. Every signup INSERTS a submission; a repeat email is a new row under the
// same lead, never an edit of the old one. The previous shape was insert-or-enrich, and collapsing two
// submitters onto one row is what created every write-policy question this module used to answer:
// DAR-59's keepExisting/fillIfEmpty split, DAR-72's actionable/judgement taxonomy, and the
// decline-wins consent rule all existed because two people could write one column. They can't now, so
// there is exactly ONE rule left (provided-wins, below) and it is a UX nicety rather than a security
// boundary — see the note above applyWaitlistStep.
//
// The three writes and what each is for (the one read, `readWaitlistTriageWindow`, is at the bottom):
//
//   insertWaitlistSubmission — upserts the LEAD (the collated person, one row per email) and then
//   always inserts a SUBMISSION under it. Returns `isNew` for the caller's email gate and the
//   submission `id` the continuation token binds to.
//
//   applyWaitlistStep — the ONLY write path for the optional steps 2–4, keyed strictly by submission
//   id (the caller resolves it from a verified token), building each step's SET clause from an
//   explicit per-step column list. The token now addresses the row ITS OWN submitter created, so a
//   step can only ever edit the answers that submitter gave.
//
//   claimPriorityLeadNotification — spends a lead's one-and-only Priority-A notification (DAR-82),
//   as a conditional UPDATE rather than a check. Same family as the two gates above: the database
//   decides, in the statement that does the work.
//
//   claimUpdatesConfirmSend / confirmUpdates / unsubscribeUpdates / readUpdatesAudience — DAR-139's
//   sending gate for product-and-research updates. Same family again: each write settles its own
//   outcome inside one statement and reports the post-state, so no caller has to read, decide and
//   write. See the block above them.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { waitlistLead, waitlistSubmission } from './db/schema';
import type { WaitlistUpdatesSignals } from '$lib/waitlist-updates';
import type { WaitlistLeadRow, WaitlistSubmissionRow } from './waitlist-collate';
import type { WaitlistLeadSignals } from './waitlist-classify';
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
 *   `leadId` — the collated person. Returned because DAR-139's confirmation-request claim addresses a
 *              LEAD (a standing decision about an address, not about one form fill), and the caller
 *              would otherwise have to re-read by email the row this function just resolved.
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
): Promise<{ isNew: boolean; id: string; leadId: string }> {
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

	return { isNew, id: inserted[0].id, leadId };
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
 * The submission as it stands AFTER a step write — the rubric's inputs, plus who to address about it.
 *
 * `extends WaitlistLeadSignals` is doing real work, twice over. It forces the `RETURNING` list below
 * to keep covering exactly what `classifyWaitlistLead` reads, so adding a signal to the rubric is a
 * compile error here rather than a notification that quietly stops firing. And it inherits DAR-65's
 * money guardrail wholesale: `economic_impact` and `budget_range` are absent from that interface on
 * purpose, so a self-reported dollar figure cannot travel this path into an email that says "hot
 * lead" — the figures stay on the row detail, where a human weighs them.
 *
 * Read post-update, which is what makes it usable as a transition input at all: SQLite's `RETURNING`
 * on an UPDATE yields the new values, so a `coalesce`-preserved answer from an earlier step comes
 * back alongside the one this step just wrote. There is no second query — the UPDATE was already
 * returning a column to count.
 */
export interface WaitlistStepOutcome extends WaitlistLeadSignals {
	/** The collated person this submission belongs to — what the notification claim addresses. */
	leadId: string;
	email: string;
	name: string | null;
}

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
 *
 * `outcome` is the written row (DAR-82), non-null exactly when `updated` is true — both are read off
 * the same `.returning()`, so they cannot disagree. It exists so a caller can ask "does this row NOW
 * classify Priority A?" without a follow-up read. Like `updated`, it must never reach the visitor:
 * every step response is one generic success.
 */
export async function applyWaitlistStep(
	db: Db,
	id: string,
	data: WaitlistStepData
): Promise<{ updated: boolean; outcome: WaitlistStepOutcome | null }> {
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
		// The rubric's inputs, post-update — see WaitlistStepOutcome. Free: this UPDATE already had a
		// RETURNING clause so it could tell a permitted write from a refused one.
		.returning({
			leadId: waitlistSubmission.leadId,
			email: waitlistSubmission.email,
			name: waitlistSubmission.name,
			role: waitlistSubmission.role,
			primaryApplication: waitlistSubmission.primaryApplication,
			evaluationTimeline: waitlistSubmission.evaluationTimeline,
			pilotInterest: waitlistSubmission.pilotInterest
		});

	return { updated: updated.length > 0, outcome: updated[0] ?? null };
}

/**
 * Spend a lead's one-and-only Priority-A notification (DAR-82). True when THIS call claimed it, false
 * when someone already had — or when the lead is gone.
 *
 * The guard is the UPDATE, not a check in front of one. `priority_a_notified_at IS NULL` in the WHERE
 * clause means the database settles the race: two step writes arriving together both see a null if
 * they read first, but only one of them can write it, so exactly one email is sent. That is the same
 * shape as `isNew` on the lead insert and as the funnel's composite key — a cap enforced by the
 * statement that does the work, with no counting query to get wrong.
 *
 * CLAIM BEFORE SEND, which is the OPPOSITE polarity to DAR-67's invitation (that one mails first and
 * stamps after, so a failed send stays retryable). The difference is who retries. An invitation has an
 * operator standing over it; this fires from a visitor's step submit that will not happen again, so
 * there is nobody to notice a duplicate and nobody to ask. At-most-once is therefore the property
 * worth having, and the cost of buying it is bounded: a send that fails after the claim loses one
 * email, and the lead still lands at the top of /admin/waitlist, sorted into the Priority-A band. The
 * notification accelerates triage; it was never the system of record.
 */
export async function claimPriorityLeadNotification(db: Db, leadId: string): Promise<boolean> {
	const claimed = await db
		.update(waitlistLead)
		.set({ priorityANotifiedAt: DB_NOW })
		.where(
			and(
				eq(waitlistLead.id, leadId),
				isNull(waitlistLead.priorityANotifiedAt),
				// "Don't contact me" (DAR-191). This notification exists to say "invite them", and the
				// invite now refuses — so firing it would be us prompting ourselves toward an action the
				// code will not perform. One more predicate on the UPDATE that was already happening: no
				// extra query, no code path that could answer "is this address flagged?" to a caller.
				isNull(waitlistLead.doNotContactAt)
			)
		)
		.returning({ id: waitlistLead.id });
	return claimed.length > 0;
}

// ---------------------------------------------------------------------------------------------
// The sending gate for product-and-research updates (DAR-139).
//
// `waitlist_submission.consent_updates` is an unverified single-opt-in claim from an unauthenticated
// form, and /privacy states publicly that it will not drive a send until the address is confirmed by
// email and every message carries a login-free unsubscribe (DAR-121). These four functions are that
// promise: the first asks, the next two record the mailbox's answer, and the last is the only
// definition of who may be written to.
//
// All three writes are the shape the rest of this module already uses — the DATABASE settles the
// outcome inside the statement that does the work, so nothing reads-then-decides-then-writes and there
// is no race to lose. The two mutations additionally RETURN the post-state, so the page a visitor
// lands on renders what is true rather than what it assumed would be.

/**
 * How often one address may be asked to confirm.
 *
 * A WINDOW, not a once-ever claim, and the difference from DAR-82's `priority_a_notified_at` is who
 * receives the mail. That notification lands in our own inbox with an operator standing over it, so
 * at-most-once is the property worth buying. This one goes to a member of the public who may simply
 * lose it, and a legitimate re-tick tomorrow has to be able to ask again — a quota would silently make
 * the box permanently unanswerable for anyone whose first confirmation went astray.
 *
 * What it bounds is the exposure append-only leaves open: anyone can submit a known address, so a
 * stranger can now cause mail to a third party where `isNew` used to make that impossible. One per day
 * is the ceiling, on top of step 1's per-IP throttle — and the "don't ask again" link inside that very
 * email ends it permanently in one click, which is the real bound and the reason the link ships in the
 * confirmation request rather than only in updates that do not exist yet.
 */
export const WAITLIST_UPDATES_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day

/** Asked at least a window ago (or never). On the DB clock, like every other comparison here. */
const UPDATES_ASK_ALLOWED = sql`(updates_confirm_sent_at is null
	or updates_confirm_sent_at <= (${DB_NOW} - ${WAITLIST_UPDATES_CONFIRM_WINDOW_MS}))`;

/**
 * The three columns `waitlistUpdatesState` reads, as one column map — used by both mutations' RETURNING
 * and by the triage read below, so "what the state is derived from" is written once. Typed by
 * `WaitlistUpdatesSignals` at every call site, so dropping one is a compile error rather than a badge
 * that silently stops escalating.
 */
const UPDATES_SIGNALS = {
	updatesConfirmSentAt: waitlistLead.updatesConfirmSentAt,
	updatesConfirmedAt: waitlistLead.updatesConfirmedAt,
	updatesUnsubscribedAt: waitlistLead.updatesUnsubscribedAt
} as const;

/**
 * Claim the right to send this lead one confirmation request. True when THIS call claimed it.
 *
 * Three refusals, and each is a rule rather than an optimization:
 *
 *   - ALREADY CONFIRMED → we have the answer; asking again is noise.
 *   - ALREADY WITHDRAWN → the durable one. The form is the single surface a stranger controls, so if a
 *     re-tick could restart the asks then unsubscribing would stop one message instead of the
 *     relationship. Re-entry deliberately needs a channel the form cannot reach.
 *   - ASKED INSIDE THE WINDOW → the rate cap above.
 *   - DO NOT CONTACT (DAR-191) → the effect of that flag has to be uniform across every surface it can
 *     reach (DAR-83's lesson). This ask is the one piece of mail a stranger can cause us to send to an
 *     address that has confirmed nothing, so leaving it open would let somebody re-type the address of
 *     the very person who asked us to stop and put us back in their inbox.
 *
 * A missing lead simply matches nothing, so a deleted row and a refused claim are the same `false` —
 * the caller sends nothing either way and has no reason to tell them apart.
 */
export async function claimUpdatesConfirmSend(db: Db, leadId: string): Promise<boolean> {
	const claimed = await db
		.update(waitlistLead)
		.set({ updatesConfirmSentAt: DB_NOW })
		.where(
			and(
				eq(waitlistLead.id, leadId),
				isNull(waitlistLead.updatesConfirmedAt),
				isNull(waitlistLead.updatesUnsubscribedAt),
				isNull(waitlistLead.doNotContactAt),
				UPDATES_ASK_ALLOWED
			)
		)
		.returning({ id: waitlistLead.id });
	return claimed.length > 0;
}

/**
 * Record that this address's MAILBOX said yes. Returns the lead's state after the write, or null when
 * no such lead exists (deleted between the mail going out and the click).
 *
 * IDEMPOTENT AND NON-REVERSING, both inside the one SET expression. `coalesce` keeps the first
 * confirmation's timestamp, so a double-click or a re-visit changes nothing; the `case` refuses to
 * stamp at all once the address has withdrawn, so an old confirmation link found after unsubscribing
 * reports the opt-out instead of undoing it. SQLite evaluates SET against the PRE-update row, which is
 * what lets both conditions read the values they are replacing.
 *
 * Returning the post-state rather than a boolean is what keeps the page honest: "confirmed",
 * "already confirmed" and "you have opted out" are three different things to say, and the alternative
 * is a second read that could disagree with the write.
 */
export async function confirmUpdates(
	db: Db,
	leadId: string
): Promise<WaitlistUpdatesSignals | null> {
	const rows = await db
		.update(waitlistLead)
		.set({
			updatesConfirmedAt: sql`case when updates_unsubscribed_at is null
				then coalesce(updates_confirmed_at, ${DB_NOW})
				else updates_confirmed_at end`
		})
		.where(eq(waitlistLead.id, leadId))
		.returning(UPDATES_SIGNALS);
	return rows[0] ?? null;
}

/**
 * Record a withdrawal. Returns the lead's state after the write, or null when no such lead exists.
 *
 * MONOTONIC — `coalesce` keeps the FIRST withdrawal's timestamp, so re-clicking an old link never
 * rewrites when the person actually opted out. `updates_confirmed_at` is deliberately left standing
 * beside it: it is the record of what happened, `mayReceiveUpdates` already excludes a withdrawn lead,
 * and clearing it would destroy evidence to buy nothing.
 *
 * Unconditional, unlike its twin: there is no state from which a withdrawal should be refused. A lead
 * that was never asked can still say "don't", which is exactly what someone whose address a stranger
 * typed in would want to do.
 *
 * `recordedBy` is REQUIRED and nullable rather than optional (DAR-140), and the awkwardness is the
 * point: two callers now reach this — the emailed link, where the mailbox itself acted, and
 * /admin/waitlist, where staff transcribed a request that arrived another way — and the difference is
 * the whole audit value of the column. An optional parameter would let a future third caller record a
 * withdrawal with no actor by simply not thinking about it; a required one makes the self-service call
 * site say `null` out loud, which is a claim rather than an omission.
 *
 * It is stamped under the SAME first-writer-wins guard as the timestamp, not `coalesce`d on its own
 * value, because null is a MEANINGFUL value here: `coalesce(updates_unsubscribed_by, <staff id>)` would
 * happily overwrite a self-service withdrawal's null the first time an operator pressed the button, and
 * the row would then claim we did what the person had already done for themselves. SQLite evaluates SET
 * against the pre-update row, so both expressions read the values they are replacing.
 *
 * Returns `email` alongside the signals so the admin action can name the address it just acted on — a
 * one-click irreversible write has to confirm WHICH row, the same rule DAR-67's invite follows. The
 * public route ignores the extra field.
 */
export async function unsubscribeUpdates(
	db: Db,
	leadId: string,
	recordedBy: string | null
): Promise<(WaitlistUpdatesSignals & { email: string }) | null> {
	const rows = await db
		.update(waitlistLead)
		.set({
			updatesUnsubscribedAt: sql`coalesce(updates_unsubscribed_at, ${DB_NOW})`,
			updatesUnsubscribedBy: sql`case when updates_unsubscribed_at is null
				then ${recordedBy}
				else updates_unsubscribed_by end`
		})
		.where(eq(waitlistLead.id, leadId))
		.returning({ ...UPDATES_SIGNALS, email: waitlistLead.email });
	return rows[0] ?? null;
}

/**
 * Everyone who may be sent a product-or-research update. THE AUDIENCE, and the only query that
 * defines it.
 *
 * This is `mayReceiveUpdates` ($lib/waitlist-updates.ts) written as a `WHERE`, and the two cannot be
 * single-sourced because one of them is SQL — the same split DAR-71 has for the `noIndex` rule, which
 * lives half in GROQ. So they are pinned against each other instead: waitlist-store.spec.ts runs a
 * table of leads through both and requires them to agree, which is what makes a drift a failing test
 * rather than an audience that quietly includes someone who opted out.
 *
 * NO SENDER CALLS THIS YET, deliberately — DAR-139 builds the gate, not a campaign. Shipping the
 * definition with it is the point: the rule has one home before the first send is written, rather than
 * being re-derived by whoever writes it. What this cannot do is force that author to use it; removing
 * the SILENT path is `email-senders.spec.ts`'s job, and its failure message names this function.
 */
export async function readUpdatesAudience(db: Db): Promise<{ id: string; email: string }[]> {
	return db
		.select({ id: waitlistLead.id, email: waitlistLead.email })
		.from(waitlistLead)
		.where(
			and(isNotNull(waitlistLead.updatesConfirmedAt), isNull(waitlistLead.updatesUnsubscribedAt))
		)
		.orderBy(waitlistLead.email);
}

// ---------------------------------------------------------------------------------------------
// "Don't contact me" (DAR-191) — the second consent axis.
//
// Both writes here are staff-only, from /admin/waitlist. There is no self-service link on this axis
// (the requests it exists for arrive as a reply or a phone call), which is the one structural
// difference from DAR-139's gate above; the column shapes are otherwise deliberately identical, so an
// operator reading a row does not have to learn two vocabularies.
//
// NOTE what is NOT here: an audience query. `mayContactLead` is consulted at three points — the
// invite's own lookup and the two claims above — and each of those already had a statement to hang a
// predicate on. There is no set of people to enumerate, only writes to refuse.
// ---------------------------------------------------------------------------------------------

/**
 * Record that this person has asked us not to contact them. Returns the post-state plus `email`, or
 * null when no such lead exists (deleted between render and click).
 *
 * MONOTONIC, and the actor is stamped under the TIMESTAMP's first-writer-wins `case` rather than
 * `coalesce`d on its own value — the same shape as `unsubscribeUpdates`, and for the reason that was
 * mutation-proven there: `coalesce(do_not_contact_by, <staff id>)` reads the ACTOR to decide whether
 * to write the actor, so any row already carrying a null recorder would silently gain the name of the
 * next operator to press the button — a row claiming somebody recorded a request that predates them.
 * SQLite evaluates SET against the PRE-update row, which is what lets both expressions read the values
 * they are replacing.
 *
 * `recordedBy` is nullable because the COLUMN is, not because a caller should pass null: nothing
 * produces one today (this axis has no self-service link), so a null recorder means we do not know,
 * and the guard's job is to leave that alone rather than paper over it.
 *
 * Unconditional. There is no state from which "please stop contacting me" should be refused.
 */
export async function recordDoNotContact(
	db: Db,
	leadId: string,
	recordedBy: string | null
): Promise<{ doNotContactAt: Date | null; email: string } | null> {
	const rows = await db
		.update(waitlistLead)
		.set({
			doNotContactAt: sql`coalesce(do_not_contact_at, ${DB_NOW})`,
			doNotContactBy: sql`case when do_not_contact_at is null
				then ${recordedBy}
				else do_not_contact_by end`
		})
		.where(eq(waitlistLead.id, leadId))
		.returning({ doNotContactAt: waitlistLead.doNotContactAt, email: waitlistLead.email });
	return rows[0] ?? null;
}

/**
 * Lift a recorded do-not-contact. Returns `email`, or null when no such lead exists.
 *
 * ADMIN-ONLY at the call site, and that gate is the design rather than a permission detail: recording
 * somebody's request is ordinary staff work, un-recording it is not. Without the asymmetry the control
 * would sit one click from the Invite button it suppresses, which turns a durable request into a speed
 * bump. With it, a mis-press on the wrong row and a prospect who later says "actually, let's talk" both
 * stay recoverable without deleting their submissions.
 *
 * CLEARS BOTH COLUMNS rather than stamping a third "lifted" pair. The durable history is the
 * `[outreach] donotcontact.lifted` Workers Logs line — the same posture `invited_at` has, where a
 * resend overwrites the stamp and the per-invite log line keeps the trail. A lifted-at column would
 * turn `mayContactLead` into a comparison of two timestamps for a state nobody queries historically.
 *
 * Unconditional, so lifting a lead that was never flagged is a harmless no-op rather than an error to
 * explain; the control only renders for a flagged lead in the first place.
 */
export async function liftDoNotContact(db: Db, leadId: string): Promise<{ email: string } | null> {
	const rows = await db
		.update(waitlistLead)
		.set({ doNotContactAt: null, doNotContactBy: null })
		.where(eq(waitlistLead.id, leadId))
		.returning({ email: waitlistLead.email });
	return rows[0] ?? null;
}

/**
 * The /admin/waitlist triage window: the `limit` most recently ACTIVE leads, plus every submission
 * belonging to them. Collation (grouping, classification, conflict detection) happens on the result
 * in waitlist-collate.ts — this only reads.
 *
 * ORDERED BY LAST ACTIVITY, NOT LEAD CREATION, and that distinction is the reason this function
 * exists. Ordering by `waitlist_lead.created_at` is a real hole once submissions append: a prospect
 * who signed up months ago and submitted again this morning is exactly the row an operator needs to
 * see, and they would drop out of the window the moment `limit` newer people existed. `coalesce` to
 * the lead's own creation so a lead with no submissions still sorts somewhere sensible.
 *
 * The cap is on LEADS. One person is one line however many times they submitted, which is the unit
 * being triaged; capping submissions would let a single repeat submitter push everyone else off the
 * page.
 *
 * Cost: one correlated index lookup per lead for the sort (the `(lead_id, created_at)` index covers
 * it), evaluated before the LIMIT. Cheap at this scale; if the lead count ever makes it hurt, the fix
 * is a stored `last_activity_at` on the lead bumped by the insert, not a return to creation order.
 *
 * Two queries rather than a join: a join would repeat every lead column once per submission and then
 * need re-grouping in memory anyway, and the second query is skipped entirely on an empty window.
 */
export async function readWaitlistTriageWindow(
	db: Db,
	limit: number
): Promise<{ leads: WaitlistLeadRow[]; submissions: WaitlistSubmissionRow[] }> {
	const lastActivityAt = sql`coalesce(
		(select max(${waitlistSubmission.createdAt}) from ${waitlistSubmission}
		 where ${waitlistSubmission.leadId} = ${waitlistLead.id}),
		${waitlistLead.createdAt}
	)`;

	const leads = await db
		.select({
			id: waitlistLead.id,
			email: waitlistLead.email,
			invitedAt: waitlistLead.invitedAt,
			invitedBy: waitlistLead.invitedBy,
			activatedAt: waitlistLead.activatedAt,
			reviewedAt: waitlistLead.reviewedAt,
			reviewedBy: waitlistLead.reviewedBy,
			// Where this address stands on updates (DAR-139) — a lead-level fact, so it belongs on the
			// lead read rather than being inferred from the per-submission `consent_updates` claims below.
			...UPDATES_SIGNALS,
			// Listed separately rather than folded into UPDATES_SIGNALS: that map is typed by
			// `WaitlistUpdatesSignals`, which is exactly the set `waitlistUpdatesState` derives from, and
			// who recorded a withdrawal is PROVENANCE rather than state (DAR-140). Widening the signals
			// would offer the state function an input it must never branch on.
			updatesUnsubscribedBy: waitlistLead.updatesUnsubscribedBy,
			// The outreach axis (DAR-191). Listed as plain columns for the same reason: there is no
			// signals map to fold them into, `mayContactLead` reads the timestamp alone, and who recorded
			// it is provenance the rule must never branch on.
			doNotContactAt: waitlistLead.doNotContactAt,
			doNotContactBy: waitlistLead.doNotContactBy,
			createdAt: waitlistLead.createdAt
		})
		.from(waitlistLead)
		.orderBy(desc(lastActivityAt))
		.limit(limit);

	if (leads.length === 0) return { leads, submissions: [] };

	const submissions = await db
		.select({
			id: waitlistSubmission.id,
			leadId: waitlistSubmission.leadId,
			email: waitlistSubmission.email,
			name: waitlistSubmission.name,
			company: waitlistSubmission.company,
			role: waitlistSubmission.role,
			companySize: waitlistSubmission.companySize,
			interest: waitlistSubmission.interest,
			hearAbout: waitlistSubmission.hearAbout,
			phone: waitlistSubmission.phone,
			countryRegion: waitlistSubmission.countryRegion,
			consentUpdates: waitlistSubmission.consentUpdates,
			consentUpdatesAt: waitlistSubmission.consentUpdatesAt,
			primaryApplication: waitlistSubmission.primaryApplication,
			evaluationTimeline: waitlistSubmission.evaluationTimeline,
			currentApproach: waitlistSubmission.currentApproach,
			economicImpact: waitlistSubmission.economicImpact,
			budgetRange: waitlistSubmission.budgetRange,
			adoptionEvidence: waitlistSubmission.adoptionEvidence,
			pilotInterest: waitlistSubmission.pilotInterest,
			deploymentScale: waitlistSubmission.deploymentScale,
			contactPermission: waitlistSubmission.contactPermission,
			contactMethod: waitlistSubmission.contactMethod,
			researchPreferences: waitlistSubmission.researchPreferences,
			qualificationStep: waitlistSubmission.qualificationStep,
			createdAt: waitlistSubmission.createdAt,
			updatedAt: waitlistSubmission.updatedAt
		})
		.from(waitlistSubmission)
		.where(
			inArray(
				waitlistSubmission.leadId,
				leads.map((lead) => lead.id)
			)
		);

	return { leads, submissions };
}
