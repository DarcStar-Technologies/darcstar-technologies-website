// Role options for the waitlist form. Client-safe (NO server or SvelteKit imports) so the form's
// <select> and the server-only validator (src/lib/server/waitlist.ts) share ONE slug list — the
// select can't offer a value the server doesn't know, and a tampered value coerces to null.
// Slugs are stable/storable; human labels are Paraglide messages (waitlist-role-labels.ts).
export const WAITLIST_ROLES = [
	'founder',
	'engineering',
	'product',
	'research',
	'operations',
	'investor',
	'student',
	'other'
] as const;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];
