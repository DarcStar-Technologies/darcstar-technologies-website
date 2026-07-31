// Waitlist v2 qualification option slugs (DAR-59) — the progressive flow's single source of truth,
// shared by the step forms' inputs (DAR-60…DAR-63) and the server-only step validators
// (src/lib/server/waitlist.ts). Client-safe (NO server or SvelteKit imports), same contract as
// waitlist-roles.ts: slugs are stable/storable; human labels are Paraglide messages added by each
// step's UI PR. One module rather than one file per list — labels land per-step later, and the
// validators want the whole set in one import.
//
// WAITLIST_V2_ROLES intentionally does NOT replace WAITLIST_ROLES: the v1 form still renders the
// old list until DAR-60/61 swap the UI. Old slugs remain in existing rows as historical values.

/** Step 1 — country or region (coarse on purpose; DAR-60 may refine before the UI ships). */
export const WAITLIST_REGIONS = [
	'north-america',
	'latin-america',
	'europe',
	'middle-east',
	'africa',
	'asia-pacific',
	'other'
] as const;
export type WaitlistRegion = (typeof WAITLIST_REGIONS)[number];

/** Step 2 — primary application. */
export const WAITLIST_APPLICATIONS = [
	'robotics-autonomous-systems',
	'industrial-infrastructure-control',
	'financial-market-control',
	'ai-agents-llm-systems',
	'self-improving-software',
	'formal-verification-infrastructure',
	'research-education',
	'other'
] as const;
export type WaitlistApplication = (typeof WAITLIST_APPLICATIONS)[number];

/** Step 2 — role (v2 set; the v1 WAITLIST_ROLES slugs live on only as stored history). */
export const WAITLIST_V2_ROLES = [
	'founder-executive',
	'engineering-leader',
	'researcher',
	'safety-risk-compliance',
	'product-operations',
	'investor-advisor',
	'student',
	'other'
] as const;
export type WaitlistV2Role = (typeof WAITLIST_V2_ROLES)[number];

/** Step 2 — evaluation timeline. */
export const WAITLIST_TIMELINES = [
	'evaluating-now',
	'within-3-months',
	'3-12-months',
	'over-12-months',
	'general-interest'
] as const;
export type WaitlistTimeline = (typeof WAITLIST_TIMELINES)[number];

/** Step 3 — current approach to the problem. */
export const WAITLIST_APPROACHES = [
	'internal-system',
	'commercial-product',
	'conventional-automation',
	'manual-operation',
	'research-prototype',
	'no-current-solution',
	'other'
] as const;
export type WaitlistApproach = (typeof WAITLIST_APPROACHES)[number];

/** Step 3 — annual economic value GIDE could create or protect. */
export const WAITLIST_IMPACTS = [
	'under-10k',
	'10k-50k',
	'50k-250k',
	'250k-1m',
	'over-1m',
	'not-sure'
] as const;
export type WaitlistImpact = (typeof WAITLIST_IMPACTS)[number];

/**
 * Step 3 — budget for an INITIAL EVALUATION OR PILOT, not annual contract value (DAR-126).
 *
 * The scope change forced the bands: annual figures put an early-product evaluation at the bottom of
 * the ladder, so almost every answer landed in the lowest one or two bands and the facet stopped
 * discriminating. These are sized for what an evaluation actually costs.
 *
 * `not-involved-in-purchasing` and `not-sure` carry over deliberately — they say something about the
 * respondent rather than about a figure, so they mean the same thing under either scope and keep ONE
 * label. Every band that IS a figure is new; see WAITLIST_ANNUAL_BUDGETS below for why that matters.
 */
export const WAITLIST_BUDGETS = [
	'under-10k',
	'10k-25k',
	'25k-50k',
	'50k-100k',
	'over-100k',
	'not-involved-in-purchasing',
	'not-sure'
] as const;
export type WaitlistBudget = (typeof WAITLIST_BUDGETS)[number];

/**
 * The retired ANNUAL bands (DAR-126) — stored history only, never offered by the form again.
 *
 * Submissions are append-only since DAR-88, so these slugs stay in rows that were answered under the
 * old question and nothing rewrites them. That is only safe because they are DISJOINT from the live
 * set: `budget_range` now holds answers to two differently-scoped questions, so a slug reused across
 * the change would be a value an operator cannot interpret — an annual $25k–$100k and an evaluation
 * $25k–$100k are wildly different buying signals wearing the same string. `waitlistBudgetLabel`
 * therefore labels these too, marked as annual, and `waitlist-qualification.spec.ts` pins the
 * disjointness so a future re-banding can't quietly collide with either set.
 *
 * APPEND ONLY. Every entry is a slug some stored row still holds, so removing one doesn't tidy this
 * list — it drops that row back to rendering its raw slug in triage. The next re-band adds its own
 * retired figures here; it never edits these. Deleting one fails the spec, which holds this list
 * against the `waitlist_budget_annual_*` messages that exist for exactly these slugs.
 */
export const WAITLIST_ANNUAL_BUDGETS = [
	'under-5k',
	'5k-25k',
	'25k-100k',
	'100k-500k',
	'over-500k'
] as const;
export type WaitlistAnnualBudget = (typeof WAITLIST_ANNUAL_BUDGETS)[number];

/** Step 3 — adoption evidence (multi-select, capped at WAITLIST_EVIDENCE_MAX). */
export const WAITLIST_EVIDENCE = [
	'evaluation-pilot',
	'formal-proof-artifacts',
	'performance-benchmarks',
	'third-party-review',
	'regulatory-compliance',
	'systems-integration',
	'production-references',
	'sla-support',
	'other'
] as const;
export type WaitlistEvidence = (typeof WAITLIST_EVIDENCE)[number];
export const WAITLIST_EVIDENCE_MAX = 3;

/** Step 4A — paid evaluation / pilot interest. */
export const WAITLIST_PILOT_INTERESTS = [
	'yes-within-3-months',
	'yes-within-6-months',
	'yes-within-12-months',
	'possibly-contact-me',
	'not-currently'
] as const;
export type WaitlistPilotInterest = (typeof WAITLIST_PILOT_INTERESTS)[number];

// The "positive" pilot answers — the server-side truth of whether the follow-up contact block
// (permission / method / phone) should have been shown. DAR-63 gates the block's RENDERING on this
// same predicate, and the step-4A validator gates whether contact_permission is a real answer (a
// boolean) or "never asked" (null) on it — so the two can't drift. `not-currently` and an unset
// answer are NOT positive.
export const WAITLIST_POSITIVE_PILOT_INTERESTS = [
	'yes-within-3-months',
	'yes-within-6-months',
	'yes-within-12-months',
	'possibly-contact-me'
] as const;
export const isPositivePilotInterest = (v: string | null): boolean =>
	v !== null && (WAITLIST_POSITIVE_PILOT_INTERESTS as readonly string[]).includes(v);

/**
 * Step 4A — would they consider signing a nonbinding letter of intent for a paid evaluation (DAR-112)?
 *
 * A TRIAGE TAG, NOT AN LOI. This is the whole rule and it governs every downstream use: the answer is
 * a self-reported intention from an unauthenticated, unverified form, so it must never be described,
 * exported or counted as a commitment — not in an export, not in a deck, not in a status update. What
 * it earns a respondent is a place further up a human's reading order, which is what every other
 * qualification answer earns too.
 *
 * Kept OUT of `WaitlistLeadSignals` deliberately (DAR-65's rubric interface), so the classifier
 * structurally cannot score on it — the same guardrail the money answers get, for the same reason:
 * this is judgement material for a person, not an input to arithmetic that fires an email. It also
 * largely duplicates the signal `pilot_interest` already carries, so scoring both would double-count
 * one intention. Revisit once there is real answer distribution.
 */
export const WAITLIST_LOI_READINESS = [
	'yes',
	'possibly-after-discussion',
	'not-at-this-time'
] as const;
export type WaitlistLoiReadiness = (typeof WAITLIST_LOI_READINESS)[number];

/** Step 4A — preferred contact method. */
export const WAITLIST_CONTACT_METHODS = ['email', 'phone-video'] as const;
export type WaitlistContactMethod = (typeof WAITLIST_CONTACT_METHODS)[number];

/** Step 4B — what a research/general-interest signup wants to receive (multi-select, uncapped). */
export const WAITLIST_RESEARCH_PREFERENCES = [
	'technical-reports',
	'verification-artifacts',
	'performance-benchmarks',
	'product-demos',
	'open-source-releases',
	'company-announcements'
] as const;
export type WaitlistResearchPreference = (typeof WAITLIST_RESEARCH_PREFERENCES)[number];

/** Step 4A free-text ceiling — "approximate system type and scale", not a design document. */
export const WAITLIST_DEPLOYMENT_SCALE_MAX = 500;

/**
 * The confirmation screen's one call to action (DAR-64). A vocabulary, not a decision: WHICH of these
 * a submitter gets is chosen server-side by `confirmationCtaFor` ($lib/server/waitlist-flow.ts) from
 * the flow state, and arrives at the page as a resolved value. It lives out here for the same reason
 * every other slug list does — the component that renders it can't import from `$lib/server`.
 */
export const WAITLIST_CTAS = ['pilot', 'evidence', 'research', 'home'] as const;
export type WaitlistCta = (typeof WAITLIST_CTAS)[number];

/**
 * Internal lead classes (DAR-65), listed in TRIAGE ORDER — the index IS the priority rank, so the
 * admin view's sort and its filter chips read the same order from one place.
 *
 * INTERNAL ONLY. This is a staff-facing triage bucket: never rendered on a public page, never emailed
 * to the person classified, never described as committed pipeline. Only the VOCABULARY lives out here
 * (client-safe, because `/admin/waitlist` renders a localized badge for it) — the decision itself is
 * `classifyWaitlistLead` under `$lib/server`, exactly the split DAR-64's CTA uses.
 */
export const WAITLIST_LEAD_CLASSES = [
	'priority-a',
	'priority-b',
	'priority-c',
	'research',
	'investor'
] as const;
export type WaitlistLeadClass = (typeof WAITLIST_LEAD_CLASSES)[number];

/**
 * A lead class → its triage rank (lower sorts first). Derived from the list order above rather than
 * a second hand-maintained map, so the two can't disagree.
 *
 * A value outside the list is unreachable through the type, but ranks LAST rather than taking
 * `indexOf`'s -1 — which would sort an unrecognized bucket above Priority A, the one direction a
 * triage list must never fail in.
 */
export const waitlistLeadClassRank = (leadClass: WaitlistLeadClass): number => {
	const rank = WAITLIST_LEAD_CLASSES.indexOf(leadClass);
	return rank === -1 ? WAITLIST_LEAD_CLASSES.length : rank;
};
