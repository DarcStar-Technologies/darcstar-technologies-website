import { m } from '$lib/paraglide/messages.js';
import type { WaitlistCompanySize } from '$lib/waitlist-company-sizes';

// Slug → localized label accessor for the waitlist "company size" select. Separate from the pure
// slug list so the Paraglide dependency stays off the server (same split as the roles/interest
// pattern). Call inside a `$derived` so labels re-resolve on locale change.
export const waitlistCompanySizeLabel: Record<WaitlistCompanySize, () => string> = {
	solo: m.waitlist_size_solo,
	'2-10': m.waitlist_size_2_10,
	'11-50': m.waitlist_size_11_50,
	'51-200': m.waitlist_size_51_200,
	'201-1000': m.waitlist_size_201_1000,
	'1000-plus': m.waitlist_size_1000_plus
};
