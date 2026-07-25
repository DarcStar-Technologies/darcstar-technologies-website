import { m } from '$lib/paraglide/messages.js';
import type { WaitlistTimeline } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-2 "evaluation timeline" select (DAR-61). Kept SEPARATE
// from the pure slug list (waitlist-qualification.ts, which the server validator imports and is
// deliberately SvelteKit-import-free) so the client-only Paraglide dependency never reaches the
// server — same split as waitlist-region-labels.ts. Call the accessors inside a `$derived` so labels
// re-resolve on locale change (m.* is $state-backed).
export const waitlistTimelineLabel: Record<WaitlistTimeline, () => string> = {
	'evaluating-now': m.waitlist_timeline_evaluating_now,
	'within-3-months': m.waitlist_timeline_within_3_months,
	'3-12-months': m.waitlist_timeline_3_12_months,
	'over-12-months': m.waitlist_timeline_over_12_months,
	'general-interest': m.waitlist_timeline_general_interest
};
