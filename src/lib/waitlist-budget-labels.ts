import { m } from '$lib/paraglide/messages.js';
import type { WaitlistBudget } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-3 "realistic budget" select (DAR-62). Same
// client-only split as waitlist-approach-labels.ts. Internal-only, like the impact answers: never
// displayed back to the respondent, never emailed to them, and never described as pipeline.
export const waitlistBudgetLabel: Record<WaitlistBudget, () => string> = {
	'under-5k': m.waitlist_budget_under_5k,
	'5k-25k': m.waitlist_budget_5k_25k,
	'25k-100k': m.waitlist_budget_25k_100k,
	'100k-500k': m.waitlist_budget_100k_500k,
	'over-500k': m.waitlist_budget_over_500k,
	'not-involved-in-purchasing': m.waitlist_budget_not_involved,
	'not-sure': m.waitlist_budget_not_sure
};
