import { m } from '$lib/paraglide/messages.js';
import type { WaitlistRole } from '$lib/waitlist-roles';

// Slug → localized label accessor for the waitlist "role" select. Kept SEPARATE from the pure slug
// list (waitlist-roles.ts, which the server validator imports and is deliberately SvelteKit-import-
// free) so the client-only Paraglide dependency never reaches the server. Call the accessors inside
// a `$derived` so labels re-resolve on locale change (m.* is $state-backed).
export const waitlistRoleLabel: Record<WaitlistRole, () => string> = {
	founder: m.waitlist_role_founder,
	engineering: m.waitlist_role_engineering,
	product: m.waitlist_role_product,
	research: m.waitlist_role_research,
	operations: m.waitlist_role_operations,
	investor: m.waitlist_role_investor,
	student: m.waitlist_role_student,
	other: m.waitlist_role_other
};
