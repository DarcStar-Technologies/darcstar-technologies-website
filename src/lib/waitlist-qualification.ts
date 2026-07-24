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

/** Step 3 — realistic annual budget. */
export const WAITLIST_BUDGETS = [
	'under-5k',
	'5k-25k',
	'25k-100k',
	'100k-500k',
	'over-500k',
	'not-involved-in-purchasing',
	'not-sure'
] as const;
export type WaitlistBudget = (typeof WAITLIST_BUDGETS)[number];

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
