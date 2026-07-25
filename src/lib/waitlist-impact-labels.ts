import { m } from '$lib/paraglide/messages.js';
import type { WaitlistImpact } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-3 "economic impact" select (DAR-62) — the annual
// value GIDE could create OR PROTECT (the copy's "or protect" is deliberate: the value may be
// prevented losses, not revenue). Same client-only split as waitlist-approach-labels.ts; the answers
// are internal-only and are never shown back to the respondent or emailed to them.
export const waitlistImpactLabel: Record<WaitlistImpact, () => string> = {
	'under-10k': m.waitlist_impact_under_10k,
	'10k-50k': m.waitlist_impact_10k_50k,
	'50k-250k': m.waitlist_impact_50k_250k,
	'250k-1m': m.waitlist_impact_250k_1m,
	'over-1m': m.waitlist_impact_over_1m,
	'not-sure': m.waitlist_impact_not_sure
};
