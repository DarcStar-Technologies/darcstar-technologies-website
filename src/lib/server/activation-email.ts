// Activation email (DAR-67) — "you're invited, set your password", sent by the staff invite action
// on /admin/waitlist. Its sibling in substance is the password reset: both carry a password-reset
// token, but this one goes to somebody who has never had a password, so the copy invites rather than
// reassures. Nothing but the prose stops an invitee being told to "reset" a password they never had,
// which is what activation-email.spec.ts pins.
//
// UNLIKE every other email in this codebase, the send is AWAITED by its caller and a failure is
// surfaced (see activation.ts for why). A staff member who is told "invited" must not be the only
// person in the flow who doesn't know the mail bounced. That is this module's own policy and is
// deliberately NOT shared, even though the layout below is.
//
// The LAYOUT is shared with the password-reset + verification emails (link-email.ts) — all three are
// the same "here is a one-time link" message and were three copies of one template. This module owns
// its copy and its send; link-email.ts explains why the send deliberately stays here.
import type { Locale } from '$lib/paraglide/runtime';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, postEmail } from './email';
import { buildLinkEmail, type LinkEmailInput } from './link-email';

/** `url` is the activation link from `mintActivationLink` — a hand-minted password-reset token with a
 * week-long expiry. `name` comes from the EARLIEST submission that gave one (DAR-67): newest-name
 * would let a stranger choose the greeting on mail we send to the real person's inbox. */
export type ActivationEmailInput = LinkEmailInput;

/** Render the activation email. Pure — unit-tested. Copy is Paraglide, resolved for `locale`; the
 * shared builder escapes the caller-supplied name + url in the HTML body. */
export function buildActivationEmail(input: ActivationEmailInput, locale: Locale): OutboundEmail {
	const o = { locale };
	return buildLinkEmail(
		{
			subject: m.activation_email_subject({}, o),
			greeting: (args) => m.activation_email_greeting(args, o),
			body: m.activation_email_body({}, o),
			button: m.activation_email_button({}, o),
			linkFallback: m.activation_email_link_fallback({}, o),
			// A WEEK, not the reset flow's hour (auth-options.ts ACTIVATION_TOKEN_TTL_SECONDS) — the one
			// piece of copy where getting the family wrong sends people to a link they think is dead.
			expiry: m.activation_email_expiry({}, o),
			ignore: m.activation_email_ignore({}, o),
			signoff: m.activation_email_signoff({}, o)
		},
		input
	);
}

/**
 * Build + POST the activation email. Throws on a Resend failure — deliberately: the invite action
 * awaits this and reports the failure to the operator, who is the only person able to retry.
 */
export async function sendActivationEmail(
	apiKey: string,
	input: ActivationEmailInput,
	locale: Locale
): Promise<void> {
	await postEmail(apiKey, buildActivationEmail(input, locale));
}
