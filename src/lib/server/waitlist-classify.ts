// Internal lead classification (DAR-65) — the qualification answers reduced to ONE triage bucket for
// /admin/waitlist. Pure and DB-free (a function of columns already stored), so it's unit-tested in
// waitlist-classify.spec.ts.
//
// Deliberately under $lib/server, for the same structural reason waitlist-flow.ts is: the
// classification is INTERNAL ONLY — never shown to the visitor, never emailed to them, never
// described as committed pipeline — and SvelteKit's import guard turns that into a compile error
// rather than a code-review convention. A public page physically cannot import this module. The slug
// VOCABULARY (`WAITLIST_LEAD_CLASSES`) is client-safe and lives in waitlist-qualification.ts only so
// the admin badge can label it; that split is the one DAR-64's CTA already uses.
//
// COMPUTED ON READ, never stored. Every input is a column the flow already persists, so a
// denormalized copy would buy nothing and cost a migration, a backfill, and a recompute obligation on
// every step write (i.e. a new way to be wrong). The admin load classifies its capped window in
// memory; a rubric change takes effect on the next page view, with no rows to migrate.
//
// The routing rules it shares with the live flow (`audienceFor`, `canonicalizeWaitlistRole`,
// `isActiveEvaluationTimeline`) are IMPORTED, not restated — a rubric that drifted from the flow
// would classify people by questions they were never asked.
import {
	isPositivePilotInterest,
	waitlistLeadClassRank,
	type WaitlistLeadClass,
	type WaitlistTimeline,
	type WaitlistV2Role
} from '$lib/waitlist-qualification';
import { audienceFor, canonicalizeWaitlistRole, isActiveEvaluationTimeline } from './waitlist-flow';

/**
 * The answers the rubric is allowed to see.
 *
 * THE MONEY GUARDRAIL IS THE SHAPE OF THIS TYPE. `economic_impact` and `budget_range` are absent on
 * purpose — a stated dollar figure is a self-reported number from an unauthenticated form, and the
 * rubric's whole point is that a $25k prospect with a real system, real authority and a three-month
 * timeline outranks an anonymous ">$1M". Leaving the columns out of the input means the classifier
 * *cannot* score on them, rather than merely choosing not to; a caller that hands over a whole row
 * still can't make them count. They stay visible to a human on the row detail, where judgement (not
 * arithmetic) can weigh them.
 */
export interface WaitlistLeadSignals {
	/** Either slug set — canonicalized here, so a legacy v1 row classifies like its v2 equivalent. */
	role: string | null;
	primaryApplication: string | null;
	evaluationTimeline: string | null;
	pilotInterest: string | null;
}

/**
 * Roles that carry the authority Priority A requires — the rubric's own list. Note what's excluded
 * and why: `researcher`/`student`/`investor-advisor` never reach this test (they're routed out
 * above), and `other` is a commercial signal without a named decision-maker, so it can reach B but
 * not A. Keyed to the v2 union, so a new role slug is a compile error here rather than a silent
 * demotion.
 */
const AUTHORITY_ROLES: readonly WaitlistV2Role[] = [
	'founder-executive',
	'engineering-leader',
	'safety-risk-compliance',
	'product-operations'
];

/**
 * Priority A's tighter window — "evaluating now / within 3 months". A strict subset of
 * `isActiveEvaluationTimeline`'s 12-month window, which is what makes the A → B fall-through below
 * total: anything that clears A's timeline clears B's too. The spec pins that behaviourally (no
 * timeline yields A without also yielding B when a condition is dropped), so the two lists can't
 * drift apart into an unreachable band.
 */
const IMMEDIATE_TIMELINES: readonly WaitlistTimeline[] = ['evaluating-now', 'within-3-months'];

/**
 * Classify one signup for internal triage.
 *
 * Ordered, and the order is the rubric:
 *
 *   1. `investor`    — an investor-advisor role. Checked FIRST so a near-term, pilot-curious investor
 *                      can't score as a customer: the rubric keeps them separate from prospective
 *                      customers, and role is the whole test.
 *   2. `research`    — anything non-commercial. Reuses `audienceFor`, so researchers, students and
 *                      research-education applications land here together with the "general technical
 *                      subscriber" the rubric groups alongside them — `audienceFor`'s fail-safe
 *                      polarity means an unanswered (or unrecognized) role AND application arrives
 *                      here rather than in a priority band.
 *   3. `priority-a`  — all three of: an immediate timeline, an authority role, a POSITIVE pilot
 *                      answer (the same `isPositivePilotInterest` predicate step 4A reveals its
 *                      contact block on). Miss any one and it falls to B.
 *   4. `priority-b`  — a commercial use case still inside the 12-month window.
 *   5. `priority-c`  — longer-term commercial interest: over-12-months, general-interest, or a
 *                      timeline never given.
 *
 * Fail-safe throughout, in the same direction as the rest of the flow: every unknown lands in the
 * bucket that claims the least. Nobody is promoted by silence.
 */
export function classifyWaitlistLead(signals: WaitlistLeadSignals): WaitlistLeadClass {
	const role = canonicalizeWaitlistRole(signals.role);

	if (role === 'investor-advisor') return 'investor';
	if (audienceFor(signals) !== 'commercial') return 'research';

	const hasAuthority = role !== null && AUTHORITY_ROLES.includes(role);
	// `!= null` (not `!== null`) to match isActiveEvaluationTimeline: the column is nullable and a
	// caller outside the type could hand over undefined, and the two windows must agree on what
	// "unanswered" means or A and B could disagree about the same row.
	const isImmediate =
		signals.evaluationTimeline != null &&
		(IMMEDIATE_TIMELINES as readonly string[]).includes(signals.evaluationTimeline);

	if (isImmediate && hasAuthority && isPositivePilotInterest(signals.pilotInterest)) {
		return 'priority-a';
	}
	return isActiveEvaluationTimeline(signals.evaluationTimeline) ? 'priority-b' : 'priority-c';
}

/**
 * Classify a LEAD, which since DAR-88 is a person with N submissions rather than one row.
 *
 * Each submission is classified on its own and the strongest band wins. The alternative — reduce the
 * submissions to one signal set (newest non-null per field) and classify that — was rejected, and the
 * reason is the same one that motivated append-only in the first place: merging fields across
 * submitters can manufacture a lead that nobody actually is. A stranger's "founder-executive" combined
 * with the real person's "within 3 months" and a third submission's positive pilot answer would score
 * Priority A although no single human ever gave that combination. Classifying each submission first
 * makes that impossible: every band this can return was earned by one actual submission, in full.
 *
 * The cost, stated plainly: someone who submits a known address with flattering answers can lift that
 * lead's band. That was equally true before (they wrote those answers straight onto the real row), and
 * it is now strictly better off — the inflating submission is a separate, visible row an operator can
 * read and dismiss, and the admin view shows the per-submission bands next to it. The standing "our
 * own guess, from unverified claims" caveat on that page covers the rest.
 *
 * An empty list classifies an empty signal set, which lands in `research` — the same fail-safe floor a
 * blank submission gets. Nobody is promoted by silence, including the silence of having said nothing.
 */
export function classifyWaitlistLeadGroup(
	submissions: readonly WaitlistLeadSignals[]
): WaitlistLeadClass {
	if (submissions.length === 0) {
		return classifyWaitlistLead({
			role: null,
			primaryApplication: null,
			evaluationTimeline: null,
			pilotInterest: null
		});
	}
	return submissions
		.map(classifyWaitlistLead)
		.reduce((best, next) =>
			waitlistLeadClassRank(next) < waitlistLeadClassRank(best) ? next : best
		);
}
