import { m } from '$lib/paraglide/messages.js';
import type { WaitlistPilotInterest } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-4A "evaluation interest" select (DAR-63). Same
// client-only split as the other step label modules. This one IS shown back to the respondent while
// they answer (it drives the conditional contact block), but like the impact/budget answers it is
// never emailed to them and never described as pipeline.
export const waitlistPilotInterestLabel: Record<WaitlistPilotInterest, () => string> = {
	'yes-within-3-months': m.waitlist_pilot_yes_3m,
	'yes-within-6-months': m.waitlist_pilot_yes_6m,
	'yes-within-12-months': m.waitlist_pilot_yes_12m,
	'possibly-contact-me': m.waitlist_pilot_possibly,
	'not-currently': m.waitlist_pilot_not_currently
};
