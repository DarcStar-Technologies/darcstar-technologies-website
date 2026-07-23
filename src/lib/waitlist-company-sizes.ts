// Company-size band options for the waitlist form. Client-safe (no server/SvelteKit imports) so the
// <select> and the server validator (src/lib/server/waitlist.ts) share ONE slug list. Slugs are
// stable/storable; labels are Paraglide (waitlist-company-size-labels.ts). Ordered smallest→largest.
export const WAITLIST_COMPANY_SIZES = [
	'solo',
	'2-10',
	'11-50',
	'51-200',
	'201-1000',
	'1000-plus'
] as const;
export type WaitlistCompanySize = (typeof WAITLIST_COMPANY_SIZES)[number];
