import { m } from '$lib/paraglide/messages.js';
import type { WaitlistV2Role } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-2 "your role" select (DAR-61). This is the v2 role set
// (WAITLIST_V2_ROLES) — DISTINCT from the v1 waitlist-role-labels.ts (`waitlist_role_*`), whose slugs
// live on only as stored history and whose labels the admin view still renders. Kept SEPARATE from the
// pure slug list (waitlist-qualification.ts) so the client-only Paraglide dependency never reaches the
// server. Call the accessors inside a `$derived` so labels re-resolve on locale change.
export const waitlistV2RoleLabel: Record<WaitlistV2Role, () => string> = {
	'founder-executive': m.waitlist_v2role_founder_executive,
	'engineering-leader': m.waitlist_v2role_engineering_leader,
	researcher: m.waitlist_v2role_researcher,
	'safety-risk-compliance': m.waitlist_v2role_safety_risk_compliance,
	'product-operations': m.waitlist_v2role_product_operations,
	'investor-advisor': m.waitlist_v2role_investor_advisor,
	student: m.waitlist_v2role_student,
	other: m.waitlist_v2role_other
};
