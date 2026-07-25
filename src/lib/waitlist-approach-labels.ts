import { m } from '$lib/paraglide/messages.js';
import type { WaitlistApproach } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-3 "current approach" select (DAR-62). Kept SEPARATE
// from the pure slug list (waitlist-qualification.ts, which the server validator imports and is
// deliberately SvelteKit-import-free) so the client-only Paraglide dependency never reaches the
// server — same split as waitlist-region-labels.ts. Call the accessors inside a `$derived` so labels
// re-resolve on locale change (m.* is $state-backed).
export const waitlistApproachLabel: Record<WaitlistApproach, () => string> = {
	'internal-system': m.waitlist_approach_internal,
	'commercial-product': m.waitlist_approach_commercial,
	'conventional-automation': m.waitlist_approach_conventional,
	'manual-operation': m.waitlist_approach_manual,
	'research-prototype': m.waitlist_approach_prototype,
	'no-current-solution': m.waitlist_approach_none,
	other: m.waitlist_approach_other
};
