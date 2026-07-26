// Activation email (DAR-67) — "you're invited, set your password", sent by the staff invite action
// on /admin/waitlist. Mirrors password-reset-email.ts in shape (pure builder + a thin send), and is
// its sibling in substance: both carry a password-reset token, but this one goes to somebody who has
// never had a password, so the copy invites rather than reassures.
//
// UNLIKE every other email in this codebase, the send is AWAITED by its caller and a failure is
// surfaced (see activation.ts for why). A staff member who is told "invited" must not be the only
// person in the flow who doesn't know the mail bounced.
import type { Locale } from '$lib/paraglide/runtime';
import { CONTACT_EMAIL, SITE_NAME } from '$lib/site';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, escapeHtml, postEmail } from './email';

// Same verified role alias as the verification/reset/ack mail, Reply-To the monitored info@ inbox —
// which matters more here than elsewhere: an unexpected invitation is exactly the mail someone wants
// to reply to and ask a human about.
const ACTIVATION_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;

export interface ActivationEmailInput {
	/** The recipient — the invited prospect's waitlist email. */
	to: string;
	/** Display name for the greeting (escaped in the HTML body). */
	name: string;
	/** The activation link from `mintActivationLink`; escaped defensively in href. */
	url: string;
}

/**
 * Render the activation email. Pure — unit-tested. Copy is Paraglide, resolved for `locale`; the
 * dynamic name + url are HTML-escaped in the html body.
 */
export function buildActivationEmail(input: ActivationEmailInput, locale: Locale): OutboundEmail {
	const o = { locale };
	const subject = m.activation_email_subject({}, o);
	const body = m.activation_email_body({}, o);
	const button = m.activation_email_button({}, o);
	const linkFallback = m.activation_email_link_fallback({}, o);
	const expiry = m.activation_email_expiry({}, o);
	const ignore = m.activation_email_ignore({}, o);
	const signoff = m.activation_email_signoff({}, o);

	// --- text/plain ---
	const text = [
		m.activation_email_greeting({ name: input.name }, o),
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
	const greetingHtml = m.activation_email_greeting({ name: escapeHtml(input.name) }, o);
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

	return { from: ACTIVATION_FROM, to: input.to, replyTo: CONTACT_EMAIL, subject, text, html };
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
