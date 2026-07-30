// Password-reset email (issue: self-service password reset). Better Auth's
// `emailAndPassword.sendResetPassword` callback (auth.ts) hands us the reset `url`
// (`{ORIGIN}/api/auth/reset-password/{token}?callbackURL=/reset-password`) + the user; we render a
// localized message and POST it through the shared Resend helper (email.ts). Kept env-free and
// unit-testable (password-reset-email.spec.ts).
//
// The LAYOUT is shared with the verification + activation emails (link-email.ts) — all three are the
// same "here is a one-time link" message and were three copies of one template. This module owns its
// copy and its send; link-email.ts explains why the send deliberately stays here.
import type { Locale } from '$lib/paraglide/runtime';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, postEmail } from './email';
import { buildLinkEmail, type LinkEmailInput } from './link-email';

/** `url` is Better Auth's reset link — our own origin plus a single-use token, escaped defensively in
 * the href because the query string carries an `&`. `name` is the account holder's display name. */
export type PasswordResetEmailInput = LinkEmailInput;

/** Render the password-reset email. Pure — unit-tested. Copy is Paraglide, resolved for `locale`;
 * the shared builder escapes the caller-supplied name + url in the HTML body. */
export function buildPasswordResetEmail(
	input: PasswordResetEmailInput,
	locale: Locale
): OutboundEmail {
	const o = { locale };
	return buildLinkEmail(
		{
			subject: m.reset_email_subject({}, o),
			greeting: (args) => m.reset_email_greeting(args, o),
			body: m.reset_email_body({}, o),
			button: m.reset_email_button({}, o),
			linkFallback: m.reset_email_link_fallback({}, o),
			expiry: m.reset_email_expiry({}, o),
			ignore: m.reset_email_ignore({}, o),
			signoff: m.reset_email_signoff({}, o)
		},
		input
	);
}

/**
 * Build + POST the password-reset email. Awaited inside Better Auth's background send task, so a
 * throw here is logged by Better Auth, never surfaced to the visitor (who already saw the generic
 * "check your email"). Callers pass the Resend key resolved via readEnv.
 */
export async function sendPasswordResetEmail(
	apiKey: string,
	input: PasswordResetEmailInput,
	locale: Locale
): Promise<void> {
	await postEmail(apiKey, buildPasswordResetEmail(input, locale));
}
