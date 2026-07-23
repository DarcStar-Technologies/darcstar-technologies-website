// Password-reset email (issue: self-service password reset). Better Auth's
// `emailAndPassword.sendResetPassword` callback (auth.ts) hands us the reset `url`
// (`{ORIGIN}/api/auth/reset-password/{token}?callbackURL=/reset-password`) + the user; we render a
// localized message and POST it through the shared Resend helper (email.ts). Kept env-free and
// unit-testable (password-reset-email.spec.ts), mirroring verification-email.ts / contact-notify.ts.
import type { Locale } from '$lib/paraglide/runtime';
import { CONTACT_EMAIL, SITE_NAME } from '$lib/site';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, escapeHtml, postEmail } from './email';

// Sent FROM the Resend-verified role alias (same as the verification + contact ack), Reply-To the
// monitored info@ inbox so a confused recipient can reach a human.
const RESET_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;

export interface PasswordResetEmailInput {
	/** The recipient — the account's email. */
	to: string;
	/** Display name for the greeting (escaped in the HTML body). */
	name: string;
	/** Better Auth's reset link — our own origin + a single-use token; escaped defensively in href. */
	url: string;
}

/**
 * Render the password-reset email. Pure — unit-tested. Copy is Paraglide, resolved for `locale`; the
 * dynamic name + url are HTML-escaped in the html body (escaping the href guards against any
 * `&`/quote in the token breaking the attribute).
 */
export function buildPasswordResetEmail(
	input: PasswordResetEmailInput,
	locale: Locale
): OutboundEmail {
	const o = { locale };
	const subject = m.reset_email_subject({}, o);
	const body = m.reset_email_body({}, o);
	const button = m.reset_email_button({}, o);
	const linkFallback = m.reset_email_link_fallback({}, o);
	const expiry = m.reset_email_expiry({}, o);
	const ignore = m.reset_email_ignore({}, o);
	const signoff = m.reset_email_signoff({}, o);

	// --- text/plain ---
	const text = [
		m.reset_email_greeting({ name: input.name }, o),
		'',
		body,
		'',
		input.url,
		'',
		expiry,
		'',
		ignore,
		'',
		signoff
	].join('\n');

	// --- text/html (escape every dynamic value; the Paraglide prose is trusted) ---
	const greetingHtml = m.reset_email_greeting({ name: escapeHtml(input.name) }, o);
	const href = escapeHtml(input.url);
	const html =
		`<div style="font:14px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">` +
		`<p>${greetingHtml}</p>` +
		`<p>${body}</p>` +
		`<p style="margin:24px 0"><a href="${href}" ` +
		`style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;` +
		`text-decoration:none;border-radius:6px;font-weight:600">${button}</a></p>` +
		`<p style="color:#64748b;margin-bottom:4px">${linkFallback}</p>` +
		`<p style="margin:0 0 16px;word-break:break-all"><a href="${href}" style="color:#2563eb">${href}</a></p>` +
		`<p style="color:#64748b">${expiry}</p>` +
		`<p style="color:#64748b">${ignore}</p>` +
		`<p style="color:#64748b">${signoff}</p>` +
		`</div>`;

	return { from: RESET_FROM, to: input.to, replyTo: CONTACT_EMAIL, subject, text, html };
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
