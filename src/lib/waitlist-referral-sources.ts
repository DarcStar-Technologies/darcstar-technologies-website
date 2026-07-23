// "How did you hear about us" options for the waitlist form. Client-safe (no server/SvelteKit
// imports) so the <select> and the server validator share ONE slug list. Slugs are stable/storable;
// labels are Paraglide (waitlist-referral-labels.ts).
export const WAITLIST_REFERRAL_SOURCES = [
	'search',
	'social',
	'word-of-mouth',
	'event',
	'news',
	'other'
] as const;
export type WaitlistReferralSource = (typeof WAITLIST_REFERRAL_SOURCES)[number];
