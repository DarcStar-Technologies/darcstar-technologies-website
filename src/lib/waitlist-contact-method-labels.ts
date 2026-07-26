import { m } from '$lib/paraglide/messages.js';
import type { WaitlistContactMethod } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-4A "preferred contact method" select (DAR-63).
// Choosing `phone-video` is what reveals the phone field.
export const waitlistContactMethodLabel: Record<WaitlistContactMethod, () => string> = {
	email: m.waitlist_contact_method_email,
	'phone-video': m.waitlist_contact_method_phone_video
};
