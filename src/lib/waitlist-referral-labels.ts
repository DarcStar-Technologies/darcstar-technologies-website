import { m } from '$lib/paraglide/messages.js';
import type { WaitlistReferralSource } from '$lib/waitlist-referral-sources';

// Slug → localized label accessor for the waitlist "how did you hear about us" select. Separate from
// the pure slug list so the Paraglide dependency stays off the server. Call inside a `$derived` so
// labels re-resolve on locale change.
export const waitlistReferralLabel: Record<WaitlistReferralSource, () => string> = {
	search: m.waitlist_hear_search,
	social: m.waitlist_hear_social,
	'word-of-mouth': m.waitlist_hear_word_of_mouth,
	event: m.waitlist_hear_event,
	news: m.waitlist_hear_news,
	other: m.waitlist_hear_other
};
