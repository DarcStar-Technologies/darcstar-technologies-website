import { m } from '$lib/paraglide/messages.js';
import type { WaitlistApplication } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-2 "primary application" select (DAR-61). Kept SEPARATE
// from the pure slug list (waitlist-qualification.ts, which the server validator imports and is
// deliberately SvelteKit-import-free) so the client-only Paraglide dependency never reaches the
// server — same split as waitlist-region-labels.ts. Call the accessors inside a `$derived` so labels
// re-resolve on locale change (m.* is $state-backed).
export const waitlistApplicationLabel: Record<WaitlistApplication, () => string> = {
	'robotics-autonomous-systems': m.waitlist_application_robotics,
	'industrial-infrastructure-control': m.waitlist_application_industrial,
	'financial-market-control': m.waitlist_application_financial,
	'ai-agents-llm-systems': m.waitlist_application_ai_agents,
	'self-improving-software': m.waitlist_application_self_improving,
	'formal-verification-infrastructure': m.waitlist_application_formal_verification,
	'research-education': m.waitlist_application_research,
	other: m.waitlist_application_other
};
