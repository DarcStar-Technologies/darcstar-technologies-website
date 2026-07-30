// Sign-up email verification message (issue #96, PR 2). Better Auth's `emailVerification
// .sendVerificationEmail` callback (auth.ts) hands us the freshly-minted verify `url`
// (`{ORIGIN}/api/auth/verify-email?token=…&callbackURL=/account`) + the new user; we render a
// localized message and POST it through the shared Resend helper (email.ts). Kept separate from
// auth.ts so the builder stays env-free and unit-testable (verification-email.spec.ts).
//
// The LAYOUT is shared with the password-reset + activation emails (link-email.ts) — all three are
// the same "here is a one-time link" message and were three copies of one template. This module owns
// its copy and its send; link-email.ts explains why the send deliberately stays here.
import type { Locale } from '$lib/paraglide/runtime';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, postEmail } from './email';
import { buildLinkEmail, type LinkEmailInput } from './link-email';

/** `url` is Better Auth's verify link — our own origin plus a signed token. `name` is caller-supplied
 * at sign-up, so it is untrusted display text (the shared builder escapes it in the HTML body). */
export type VerificationEmailInput = LinkEmailInput;

/** Render the verification email. Pure — unit-tested. Copy is Paraglide, resolved for `locale`; the
 * shared builder escapes the caller-supplied name + url in the HTML body. */
export function buildVerificationEmail(
	input: VerificationEmailInput,
	locale: Locale
): OutboundEmail {
	const o = { locale };
	return buildLinkEmail(
		{
			subject: m.verify_email_subject({}, o),
			greeting: (args) => m.verify_email_greeting(args, o),
			body: m.verify_email_body({}, o),
			button: m.verify_email_button({}, o),
			linkFallback: m.verify_email_link_fallback({}, o),
			expiry: m.verify_email_expiry({}, o),
			ignore: m.verify_email_ignore({}, o),
			signoff: m.verify_email_signoff({}, o)
		},
		input
	);
}

/**
 * Build + POST the verification email. Awaited inside Better Auth's background send task, so a
 * throw here is logged by Better Auth, never surfaced to the visitor (who already saw "check your
 * email"). Callers pass the Resend key resolved via readEnv.
 */
export async function sendVerificationEmail(
	apiKey: string,
	input: VerificationEmailInput,
	locale: Locale
): Promise<void> {
	await postEmail(apiKey, buildVerificationEmail(input, locale));
}
