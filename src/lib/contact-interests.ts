// Interest options for the contact form (issue #11). Client-safe (NO server or
// SvelteKit imports) so both ContactDialog.svelte and the server-only validator
// (src/lib/server/contact.ts) share ONE slug list — the select can't offer a value
// the server doesn't know, and a tampered value is coerced to null server-side.
// Slugs are stable/storable; the human labels are Paraglide messages (contact_interest_*).
export const INTERESTS = ['robotics', 'markets', 'formal-methods', 'partnership', 'other'] as const;
export type Interest = (typeof INTERESTS)[number];
