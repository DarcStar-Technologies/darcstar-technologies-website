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
import { and, eq, sql } from 'drizzle-orm';
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
// (applyWaitlistStep) for the JUDGEMENT columns — the answers a human weighs when triaging, where
// re-asking is normal and refusing a correction would only lose data. A sparser resubmit never
// erases. See the DAR-72 note above applyWaitlistStep for why the two ACTIONABLE columns don't use it.
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

// Third policy, for `contact_permission` alone (DAR-72). A permission is not symmetric, so neither
// of the two above fits: the RESTRICTIVE answer is authoritative and the permissive one is
// fill-forward.
//
//   false → writes absolutely. An explicit decline must always stick (DAR-63's rule, and revocation
//           has to work from whoever is actually sitting at the form).
//   true  → only lands in a still-null column, i.e. on a row that was never asked. A grant can no
//           longer overturn a stored decline.
//   null  → the question wasn't shown; keep whatever stands (unchanged from DAR-63).
//
// The asymmetry is the same fail-safe polarity used for `seo.noIndex` and the commercial gate:
// acting on someone needs a POSITIVE signal that survives, while withdrawing needs only to be said
// once. Cost: a genuine visitor who declines and later changes their mind silently no-ops, and must
// tell us by replying to the address they signed up with — which is the confirmation step outreach
// is supposed to go through anyway.
function grantFillsDeclineWins(next: boolean | null, column: string) {
	if (next === null) return sql`${sql.raw(column)}`;
	if (next === false) return sql`0`;
	return sql`coalesce(${sql.raw(column)}, 1)`;
}

const DB_NOW = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

// ---------------------------------------------------------------------------------------------
// Step-write budget (DAR-68). Steps 2–4 are unauthenticated writes authorized only by the
// continuation token, and the step-1 throttle can't see them: it counts ROWS created per hashed IP,
// and a step adds no row. So a token holder could drive unbounded UPDATEs at one row.
//
// The unit is the ROW, not the IP: a token addresses exactly one row, which makes the row the thing
// being abused, and keying on it doesn't punish everyone behind a shared NAT for one of them.
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
//   (Timing still separates "the DB was touched" from "it wasn't", since an invalid or decoy token
//   short-circuits before the round trip. That channel predates this and is accepted at the token
//   layer; the budget adds nothing to it, because a refusal takes the same round trip a write does.)
//
//   NOTHING IS LOST. A refusal drops one enrichment, never a signup: the row was persisted at step
//   1 and these columns are optional extras.
//
// Two things this does NOT bound, both deliberate:
//
//   REQUEST VOLUME. A refused POST still reaches the Worker and still costs one round trip, and an
//   attacker holding tokens for N rows gets N budgets. Not fixable here — volumetric defense against
//   a distributed or multi-token flood belongs at the edge (a Cloudflare rate-limiting rule on
//   /waitlist), where it can't be sidestepped by rotating tokens.
//
//   TARGETED EXHAUSTION. Because the token reaches any submitter of a known address, someone can
//   spend a specific person's budget and silently block that person's own enrichment for the rest of
//   the window. Accepted: it costs the attacker a sustained 20 writes/hour aimed at one row, and the
//   same token already lets them write that row's qualification answers outright (the surface DAR-72
//   tracks), so denying an optional enrich is strictly the lesser of what they can already do. A
//   per-submitter budget isn't available — the whole point of these endpoints is that there is no
//   identity behind them.

/** Window length for the per-row step-write budget. */
export const WAITLIST_STEP_WRITE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Step writes allowed per row per window.
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

// True when the row's window is still live. Null (never step-written, or a pre-DAR-68 row) is false,
// so the else-branch of each CASE below opens a fresh window — no backfill needed.
const IN_WINDOW = sql`(step_write_window_at > ${STEP_WINDOW_START})`;

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

// ---------------------------------------------------------------------------------------------
// What a token holder may OVERWRITE (DAR-72). The step columns used to be uniformly keepExisting on
// the premise that "holding the continuation token is the authorization". That premise doesn't hold:
// step 1 returns the identical success shape — token included — for a new and an existing email,
// which is exactly what stops it being an enumeration oracle, and which means the token reaches ANY
// submitter of a known address. So these steps have the SAME effective authorization as the
// unauthenticated step-1 enrich, and had a WEAKER write policy than it on a column both can write.
//
// Two columns therefore move off keepExisting, picked by what they DO rather than how sensitive they
// look: `phone` is the only step-writable column that supplies a contact DESTINATION (email is in no
// step's column map — the mass-assignment guard already saw to that), and `contact_permission` is the
// flag that turns the record into permission to use one. Together they were enough to make our
// internal record say "this person wants to be called, here", with an attacker-controlled "here".
//
// Everything else stays keepExisting deliberately. Role, timeline, approach, budget, evidence and the
// rest are judgement inputs a human weighs; they can be poisoned, that is caveated on the admin page,
// and DAR-65 already keeps the self-reported money figures out of the classifier. Locking them down
// would trade a real "let someone fix their own answer" for no reduction in what an attacker can do.
//
// LIMIT, stated plainly: this bounds OVERWRITING, not the first write. A row with no phone still
// accepts an attacker's, and a row never asked about contact still accepts an attacker's grant —
// which is the common case, since `phone` is optional at step 1 and `contact_permission` starts null
// on every row. That isn't fixable here: the endpoint's entire purpose is to accept those answers
// from a submitter we cannot identify. The control that actually covers it is the process one — treat
// step 4A's contact block as a lead-qualification hint and confirm by replying to the SIGNED-UP
// address, which is the one field no step can touch. What changed is that an attacker can no longer
// overturn something the real person already told us.
//
// Rejected: giving step 4A its own `contact_phone` column so a genuine correction survives AND the
// conflict is visible to an operator. It's a migration plus a two-phone reconciliation on the admin
// page, for a case where the dominant attack (null → attacker value) is unfixed either way; a single
// uniform rule — no unauthenticated path overwrites a stored value, restrictive values always win —
// is easier to keep true. Also rejected: binding the token to the minting session or IP (DAR-72
// option 4), which would break the no-JS multi-request flow the token is echoed through.

/**
 * Apply one optional step to an existing row (id comes from a VERIFIED continuation token — this
 * function trusts its caller on that and enforces everything else). Explicit per-step SET objects
 * are the mass-assignment guard: a step can only ever write its own columns, never identity
 * (email/name/…) and never another step's answers. Judgement columns are keep-existing; the two
 * actionable ones are not — see the note above.
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
				// Tri-state, and asymmetric since DAR-72 — see grantFillsDeclineWins. A decline still
				// writes absolutely; a grant now only lands on a row that was never asked.
				contactPermission: grantFillsDeclineWins(data.contactPermission, 'contact_permission'),
				// Stays provided-wins: it picks among channels we already hold, so it can misroute a
				// conversation but can't supply a destination. Poisoning it is a judgement problem.
				contactMethod: keepExisting(data.contactMethod, 'contact_method'),
				// FILL-FORWARD (DAR-72), matching step 1's policy on this exact column rather than the
				// other step columns'. See the note above.
				phone: fillIfEmpty(data.phone, 'phone')
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
				eq(waitlist.id, id),
				// The budget check (DAR-68), as a predicate rather than a prior query — see the block
				// comment above WAITLIST_STEP_WRITE_MAX. Expired or never-opened window ⇒ allowed (and the SET
				// above opens a fresh one); otherwise allowed only while the count is under the cap.
				sql`(not ${IN_WINDOW} or coalesce(step_write_count, 0) < ${WAITLIST_STEP_WRITE_MAX})`
			)
		)
		.returning({ id: waitlist.id });

	return { updated: updated.length > 0 };
}
