import { m } from '$lib/paraglide/messages.js';
import type { WaitlistRegion } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the waitlist "country or region" select (DAR-60). Kept SEPARATE
// from the pure slug list (waitlist-qualification.ts, which the server validator imports and is
// deliberately SvelteKit-import-free) so the client-only Paraglide dependency never reaches the
// server — same split as waitlist-role-labels.ts. Call the accessors inside a `$derived` so labels
// re-resolve on locale change (m.* is $state-backed). The list is coarse on purpose (a full country
// list is heavier than the field warrants); the spec allows "country or region".
export const waitlistRegionLabel: Record<WaitlistRegion, () => string> = {
	'north-america': m.waitlist_region_north_america,
	'latin-america': m.waitlist_region_latin_america,
	europe: m.waitlist_region_europe,
	'middle-east': m.waitlist_region_middle_east,
	africa: m.waitlist_region_africa,
	'asia-pacific': m.waitlist_region_asia_pacific,
	other: m.waitlist_region_other
};
