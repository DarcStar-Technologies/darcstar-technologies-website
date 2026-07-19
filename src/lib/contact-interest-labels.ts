import { m } from '$lib/paraglide/messages.js';
import type { Interest } from '$lib/contact-interests';

// Slug → localized label accessor for the contact form's "area of interest" picker.
// Kept SEPARATE from the pure slug list (contact-interests.ts, which the server validator
// imports and is deliberately SvelteKit-import-free) so the client-only Paraglide dependency
// never reaches the server side. Shared by ContactDialog and the standalone /contact page.
// Call the accessors inside a `$derived` so labels re-resolve on locale change (m.* is
// $state-backed).
export const interestLabel: Record<Interest, () => string> = {
	robotics: m.contact_interest_robotics,
	markets: m.contact_interest_markets,
	'formal-methods': m.contact_interest_formal_methods,
	partnership: m.contact_interest_partnership,
	other: m.contact_interest_other
};
