// Slug → localized label for every waitlist select, checkbox group and admin column — the client-side
// twin of `waitlist-qualification.ts` (+ the three v1 slug modules), which hold the slugs themselves.
//
// WHY THE SPLIT: the slug lists are imported by the SERVER validators and are deliberately
// SvelteKit-import-free. The labels are Paraglide messages, which are client-side machinery, so they
// live here and never reach the server. Keep it that way — a label import inside `$lib/server` is the
// thing this file exists to prevent.
//
// CALL THE ACCESSORS INSIDE A `$derived` (directly, or via `toOptions` below). `m.*` is $state-backed,
// so a label resolved eagerly at module scope would freeze in whatever locale loaded first.
//
// One module rather than one file per list: the split rationale above was the only real content in
// thirteen near-identical files, and the lists it mirrors already live in one module.
import { m } from '$lib/paraglide/messages.js';
import type { Option } from '$lib/components/GlassSelect.svelte';
import type {
	WaitlistRegion,
	WaitlistApplication,
	WaitlistV2Role,
	WaitlistTimeline,
	WaitlistApproach,
	WaitlistImpact,
	WaitlistBudget,
	WaitlistAnnualBudget,
	WaitlistEvidence,
	WaitlistPilotInterest,
	WaitlistLoiReadiness,
	WaitlistContactMethod,
	WaitlistResearchPreference,
	WaitlistCta,
	WaitlistLeadClass
} from '$lib/waitlist-qualification';
import type { WaitlistFunnelEvent } from '$lib/waitlist-funnel';
import type { WaitlistRole } from '$lib/waitlist-roles';
import type { WaitlistCompanySize } from '$lib/waitlist-company-sizes';
import type { WaitlistReferralSource } from '$lib/waitlist-referral-sources';

/**
 * A slug list + its label map → the `{value,label}[]` a GlassSelect / GlassCheckboxGroup wants.
 *
 * Wrap the CALL in `$derived`, not this function — it resolves labels eagerly by design, so the
 * reactivity has to live at the call site: `const opts = $derived(toOptions(LIST, labels))`.
 */
export function toOptions<T extends string>(
	values: readonly T[],
	labels: Record<T, () => string>
): Option[] {
	return values.map((value) => ({ value, label: labels[value]() }));
}

// --- Step 1 ------------------------------------------------------------------------------------

/** Coarse on purpose — a full country list is heavier than the field warrants, and the spec says
 *  "country or region". */
export const waitlistRegionLabel: Record<WaitlistRegion, () => string> = {
	'north-america': m.waitlist_region_north_america,
	'latin-america': m.waitlist_region_latin_america,
	europe: m.waitlist_region_europe,
	'middle-east': m.waitlist_region_middle_east,
	africa: m.waitlist_region_africa,
	'asia-pacific': m.waitlist_region_asia_pacific,
	other: m.waitlist_region_other
};

// --- Step 2 ------------------------------------------------------------------------------------

export const waitlistApplicationLabel: Record<WaitlistApplication, () => string> = {
	'robotics-autonomous-systems': m.waitlist_application_robotics,
	'industrial-infrastructure-control': m.waitlist_application_industrial,
	'financial-market-control': m.waitlist_application_financial,
	'ai-agents-llm-systems': m.waitlist_application_ai_agents,
	'self-improving-software': m.waitlist_application_self_improving,
	'formal-verification-infrastructure': m.waitlist_application_formal_verification,
	'research-education': m.waitlist_application_research,
	other: m.waitlist_application_other
};

/** The v2 role set — DISTINCT from `waitlistRoleLabel` below, whose slugs live on only as stored
 *  history. Both render into the same `role` column, which is why the admin view needs both. */
export const waitlistV2RoleLabel: Record<WaitlistV2Role, () => string> = {
	'founder-executive': m.waitlist_v2role_founder_executive,
	'engineering-leader': m.waitlist_v2role_engineering_leader,
	researcher: m.waitlist_v2role_researcher,
	'safety-risk-compliance': m.waitlist_v2role_safety_risk_compliance,
	'product-operations': m.waitlist_v2role_product_operations,
	'investor-advisor': m.waitlist_v2role_investor_advisor,
	student: m.waitlist_v2role_student,
	other: m.waitlist_v2role_other
};

export const waitlistTimelineLabel: Record<WaitlistTimeline, () => string> = {
	'evaluating-now': m.waitlist_timeline_evaluating_now,
	'within-3-months': m.waitlist_timeline_within_3_months,
	'3-12-months': m.waitlist_timeline_3_12_months,
	'over-12-months': m.waitlist_timeline_over_12_months,
	'general-interest': m.waitlist_timeline_general_interest
};

// --- Step 3 ------------------------------------------------------------------------------------
// The impact and budget answers are INTERNAL-ONLY: never displayed back to the respondent, never
// emailed to them, never described as pipeline.

export const waitlistApproachLabel: Record<WaitlistApproach, () => string> = {
	'internal-system': m.waitlist_approach_internal,
	'commercial-product': m.waitlist_approach_commercial,
	'conventional-automation': m.waitlist_approach_conventional,
	'manual-operation': m.waitlist_approach_manual,
	'research-prototype': m.waitlist_approach_prototype,
	'no-current-solution': m.waitlist_approach_none,
	other: m.waitlist_approach_other
};

/** The annual value GIDE could create OR PROTECT — the copy's "or protect" is deliberate: the value
 *  may be prevented losses rather than revenue. */
export const waitlistImpactLabel: Record<WaitlistImpact, () => string> = {
	'under-10k': m.waitlist_impact_under_10k,
	'10k-50k': m.waitlist_impact_10k_50k,
	'50k-250k': m.waitlist_impact_50k_250k,
	'250k-1m': m.waitlist_impact_250k_1m,
	'over-1m': m.waitlist_impact_over_1m,
	'not-sure': m.waitlist_impact_not_sure
};

/**
 * The budget a respondent could put behind an initial evaluation (DAR-126) — PLUS the retired annual
 * bands, which is why the key type is the union.
 *
 * One map rather than the live/legacy pair `role` needs (see `roleFor` in /admin/waitlist): the two
 * role sets share slugs that mean the same thing in both, so resolving them needs an ORDER, while
 * these two sets are disjoint by construction and the shared non-figure slugs are scope-neutral — so
 * every key here has exactly one right answer and a plain lookup is unambiguous. It also keeps the
 * step-3 `<select>` honest for free: it builds its options from `WAITLIST_BUDGETS`, so a wider label
 * map can't leak a retired band back into the form.
 *
 * The annual labels SAY they are annual. `budget_range` now holds answers to two different questions,
 * and the operator reading a triage row has only the value to go on.
 */
export const waitlistBudgetLabel: Record<WaitlistBudget | WaitlistAnnualBudget, () => string> = {
	'under-10k': m.waitlist_budget_under_10k,
	'10k-25k': m.waitlist_budget_10k_25k,
	'25k-50k': m.waitlist_budget_25k_50k,
	'50k-100k': m.waitlist_budget_50k_100k,
	'over-100k': m.waitlist_budget_over_100k,
	'not-involved-in-purchasing': m.waitlist_budget_not_involved,
	'not-sure': m.waitlist_budget_not_sure,

	// Retired with DAR-126 — answered under "what ANNUAL budget could you consider?".
	'under-5k': m.waitlist_budget_annual_under_5k,
	'5k-25k': m.waitlist_budget_annual_5k_25k,
	'25k-100k': m.waitlist_budget_annual_25k_100k,
	'100k-500k': m.waitlist_budget_annual_100k_500k,
	'over-500k': m.waitlist_budget_annual_over_500k
};

/** The multi-select capped at `WAITLIST_EVIDENCE_MAX` — enforced server-side by the validator; the
 *  UI's disabling of unchecked boxes is enhancement only. */
export const waitlistEvidenceLabel: Record<WaitlistEvidence, () => string> = {
	'evaluation-pilot': m.waitlist_evidence_evaluation_pilot,
	'formal-proof-artifacts': m.waitlist_evidence_formal_proof,
	'performance-benchmarks': m.waitlist_evidence_benchmarks,
	'third-party-review': m.waitlist_evidence_third_party_review,
	'regulatory-compliance': m.waitlist_evidence_regulatory,
	'systems-integration': m.waitlist_evidence_integration,
	'production-references': m.waitlist_evidence_production_refs,
	'sla-support': m.waitlist_evidence_sla_support,
	other: m.waitlist_evidence_other
};

// --- Step 4 ------------------------------------------------------------------------------------

/** Shown back to the respondent while they answer (it drives the conditional contact block), but
 *  like impact/budget it is never emailed to them and never described as pipeline. */
export const waitlistPilotInterestLabel: Record<WaitlistPilotInterest, () => string> = {
	'yes-within-3-months': m.waitlist_pilot_yes_3m,
	'yes-within-6-months': m.waitlist_pilot_yes_6m,
	'yes-within-12-months': m.waitlist_pilot_yes_12m,
	'possibly-contact-me': m.waitlist_pilot_possibly,
	'not-currently': m.waitlist_pilot_not_currently
};

/**
 * LOI readiness (DAR-112) — revealed alongside the contact block, on the same positive-pilot predicate.
 *
 * The copy these keys resolve to carries the load-bearing part: the question names the letter as
 * NONBINDING and the help text says answering commits the respondent to nothing. That is not a
 * courtesy — the answer is a triage tag, and copy that let it read as an undertaking would make the
 * stored value mean something it does not.
 */
export const waitlistLoiReadinessLabel: Record<WaitlistLoiReadiness, () => string> = {
	yes: m.waitlist_loi_yes,
	'possibly-after-discussion': m.waitlist_loi_possibly,
	'not-at-this-time': m.waitlist_loi_not_now
};

/** Choosing `phone-video` is what reveals the phone field. */
export const waitlistContactMethodLabel: Record<WaitlistContactMethod, () => string> = {
	email: m.waitlist_contact_method_email,
	'phone-video': m.waitlist_contact_method_phone_video
};

/** The only qualification answers that describe something we might SEND — but they are NOT consent:
 *  `consent_updates` (step 1, an unverified single-opt-in claim) governs that. */
export const waitlistResearchPreferenceLabel: Record<WaitlistResearchPreference, () => string> = {
	'technical-reports': m.waitlist_prefs_technical_reports,
	'verification-artifacts': m.waitlist_prefs_verification_artifacts,
	'performance-benchmarks': m.waitlist_prefs_benchmarks,
	'product-demos': m.waitlist_prefs_demos,
	'open-source-releases': m.waitlist_prefs_open_source,
	'company-announcements': m.waitlist_prefs_announcements
};

// --- Confirmation ------------------------------------------------------------------------------

/** The label on the confirmation's single CTA (DAR-64). Which one a submitter sees is a SERVER
 *  decision (`confirmationCtaFor`); `WaitlistConfirmation.svelte` owns where each one points. */
export const waitlistCtaLabel: Record<WaitlistCta, () => string> = {
	pilot: m.waitlist_cta_pilot,
	evidence: m.waitlist_cta_evidence,
	research: m.waitlist_cta_research,
	home: m.waitlist_cta_home
};

// --- Internal triage (staff-only) --------------------------------------------------------------

/** The lead-class badge on /admin/waitlist (DAR-65). STAFF-ONLY copy: which class a row is in is
 *  decided server-side by `classifyWaitlistLead` and must never reach a public page or an email. */
export const waitlistLeadClassLabel: Record<WaitlistLeadClass, () => string> = {
	'priority-a': m.admin_waitlist_class_priority_a,
	'priority-b': m.admin_waitlist_class_priority_b,
	'priority-c': m.admin_waitlist_class_priority_c,
	research: m.admin_waitlist_class_research,
	investor: m.admin_waitlist_class_investor
};

/** The funnel readout's stage names on /admin/waitlist (DAR-66). Staff-only copy, like the badge
 *  above: these describe our measurement of a visitor, not anything they're ever shown. Keyed to the
 *  event union, so adding a slug without labelling it is a compile error. */
export const waitlistFunnelEventLabel: Record<WaitlistFunnelEvent, () => string> = {
	waitlist_viewed: m.admin_waitlist_funnel_viewed,
	waitlist_signup_completed: m.admin_waitlist_funnel_signup_completed,
	qualification_started: m.admin_waitlist_funnel_qualification_started,
	use_case_completed: m.admin_waitlist_funnel_use_case_completed,
	commercial_context_completed: m.admin_waitlist_funnel_commercial_context_completed,
	pilot_interest_selected: m.admin_waitlist_funnel_pilot_interest_selected,
	qualification_completed: m.admin_waitlist_funnel_qualification_completed,
	evaluation_conversation_requested: m.admin_waitlist_funnel_conversation_requested
};

// --- v1 (retired from the form, still rendered by /admin/waitlist for historical rows) ----------

export const waitlistRoleLabel: Record<WaitlistRole, () => string> = {
	founder: m.waitlist_role_founder,
	engineering: m.waitlist_role_engineering,
	product: m.waitlist_role_product,
	research: m.waitlist_role_research,
	operations: m.waitlist_role_operations,
	investor: m.waitlist_role_investor,
	student: m.waitlist_role_student,
	other: m.waitlist_role_other
};

export const waitlistCompanySizeLabel: Record<WaitlistCompanySize, () => string> = {
	solo: m.waitlist_size_solo,
	'2-10': m.waitlist_size_2_10,
	'11-50': m.waitlist_size_11_50,
	'51-200': m.waitlist_size_51_200,
	'201-1000': m.waitlist_size_201_1000,
	'1000-plus': m.waitlist_size_1000_plus
};

export const waitlistReferralLabel: Record<WaitlistReferralSource, () => string> = {
	search: m.waitlist_hear_search,
	social: m.waitlist_hear_social,
	'word-of-mouth': m.waitlist_hear_word_of_mouth,
	event: m.waitlist_hear_event,
	news: m.waitlist_hear_news,
	other: m.waitlist_hear_other
};
