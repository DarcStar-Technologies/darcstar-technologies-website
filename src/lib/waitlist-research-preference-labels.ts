import { m } from '$lib/paraglide/messages.js';
import type { WaitlistResearchPreference } from '$lib/waitlist-qualification';

// Slug → localized label accessor for the step-4B "what would you like to receive" group (DAR-63).
// These are the only qualification answers that describe something we might SEND — but they are not
// consent: `consent_updates` (step 1, still unverified single-opt-in) governs that.
export const waitlistResearchPreferenceLabel: Record<WaitlistResearchPreference, () => string> = {
	'technical-reports': m.waitlist_prefs_technical_reports,
	'verification-artifacts': m.waitlist_prefs_verification_artifacts,
	'performance-benchmarks': m.waitlist_prefs_benchmarks,
	'product-demos': m.waitlist_prefs_demos,
	'open-source-releases': m.waitlist_prefs_open_source,
	'company-announcements': m.waitlist_prefs_announcements
};
