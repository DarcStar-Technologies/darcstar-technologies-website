import { m } from '$lib/paraglide/messages.js';
import type { WaitlistEvidence } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-3 "adoption requirement" checkbox group (DAR-62) —
// the multi-select capped at WAITLIST_EVIDENCE_MAX (the cap is enforced server-side by the
// validator; the UI's disabling is enhancement only). Same client-only split as
// waitlist-approach-labels.ts.
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
