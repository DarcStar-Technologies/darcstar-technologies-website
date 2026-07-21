// Contact-form emails (issues #52, #92) — every successful submission fans out to
// two messages, sent fire-and-forget from submitContact (src/lib/contact.remote.ts):
//   1. Lead notification → the monitored info@ inbox, so leads are actionable
//      without polling the DB. Plain English: internal ops output, not localized UI,
//      so it sits outside the no-raw-text rule.
//   2. Submitter acknowledgement → the visitor's own (validated) address, confirming
//      we received the message and a human is reading it. This one IS user-facing, so
//      its copy lives in Paraglide messages and is localized to the request locale.
//
// The row is already persisted before either send, so a failure is logged, never
// surfaced to the visitor. Provider: Resend (https://resend.com) — a plain HTTPS API
// reachable from workerd via `fetch`, so no npm SDK (keeps the Worker lean and the
// payload builders pure/unit-testable).
import type { CleanedContact } from './contact';
import type { Interest } from '$lib/contact-interests';
import type { Locale } from '$lib/paraglide/runtime';
import { CONTACT_EMAIL, SITE_NAME } from '$lib/site';
import { m } from '$lib/paraglide/messages.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Both messages send FROM the Resend-verified role alias (single-sourced from
// site.ts). They differ in `to`/`replyTo`: the lead lands in info@ with Reply-To set
// to the visitor (hit Reply → reach the lead); the ack goes to the visitor with
// Reply-To back to info@ (a real, monitored mailbox — the ack invites a reply).
const LEAD_FROM = `DarcStar Contact <${CONTACT_EMAIL}>`;
const ACK_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;

// Headers marking the ack as an automated reply, so a recipient's vacation-responder /
// out-of-office doesn't reply back and open a mail loop: `Auto-Submitted: auto-replied`
// is the RFC 3834 standard (honored by modern responders), `X-Auto-Response-Suppress`
// covers Exchange/Outlook. Deliberately NOT `Precedence: bulk` — on a 1:1 transactional
// receipt that legacy signal buys little loop-prevention over Auto-Submitted and risks
// bulk/Promotions classification. Only the ack carries these (the lead goes to our inbox).
const AUTO_REPLY_HEADERS: Record<string, string> = {
	'Auto-Submitted': 'auto-replied',
	'X-Auto-Response-Suppress': 'All'
};

// Slug -> human label for the LEAD email, mirroring the contact_interest_* UI copy. A
// plain map (not Paraglide) because the lead is server-side ops output, always English.
// Keyed on the `Interest` union so adding a slug to contact-interests.ts without a label
// is a compile error, not a silent 'Not specified'.
const INTEREST_LABELS: Record<Interest, string> = {
	robotics: 'Robotics & control',
	markets: 'Financial markets',
	'formal-methods': 'Formal methods & verification',
	partnership: 'Partnership',
	other: 'Something else'
};

const interestLabel = (slug: string | null): string =>
	(slug ? INTEREST_LABELS[slug as Interest] : undefined) ?? 'Not specified';

// Localized interest label for the ACK email — reuses the same contact_interest_*
// messages the form renders. Exhaustive switch on the `Interest` union: a new slug
// without a case is a compile error (same guarantee as INTEREST_LABELS above).
function interestMessage(slug: Interest, locale: Locale): string {
	const o = { locale };
	switch (slug) {
		case 'robotics':
			return m.contact_interest_robotics({}, o);
		case 'markets':
			return m.contact_interest_markets({}, o);
		case 'formal-methods':
			return m.contact_interest_formal_methods({}, o);
		case 'partnership':
			return m.contact_interest_partnership({}, o);
		case 'other':
			return m.contact_interest_other({}, o);
	}
}

// Escape the HTML-significant chars so visitor content can't break out of — or inject
// markup into — an HTML body. The text/plain part needs no escaping.
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface OutboundEmail {
	from: string;
	to: string;
	replyTo: string;
	subject: string;
	text: string;
	html: string;
	headers?: Record<string, string>;
}

/** Render a submission into the internal lead email. Pure — unit-tested. */
export function buildLeadEmail(sub: CleanedContact): OutboundEmail {
	const interest = interestLabel(sub.interest);
	const company = sub.company ?? 'Not provided';
	const subject = `New contact: ${sub.name} — ${interest}`;

	const rows: [label: string, value: string][] = [
		['Name', sub.name],
		['Email', sub.email],
		['Company', company],
		['Interest', interest],
		['Message', sub.message]
	];

	const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

	// `white-space:pre-wrap` on the value cell preserves the message's newlines
	// (which escapeHtml leaves intact) without an error-prone \n -> <br> pass.
	const html =
		`<table role="presentation" cellpadding="0" cellspacing="0" style="font:14px/1.5 system-ui,sans-serif">` +
		rows
			.map(
				([k, v]) =>
					`<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${k}</td>` +
					`<td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`
			)
			.join('') +
		`</table>`;

	return { from: LEAD_FROM, to: CONTACT_EMAIL, replyTo: sub.email, subject, text, html };
}

/**
 * Render the submitter-facing acknowledgement. Pure — unit-tested. Copy is Paraglide,
 * resolved for `locale`; the echoed message/name are HTML-escaped in the html body.
 */
export function buildAckEmail(sub: CleanedContact, locale: Locale): OutboundEmail {
	const o = { locale };
	const subject = m.contact_ack_subject({}, o);
	const body = m.contact_ack_body({}, o);
	const copyHeading = m.contact_ack_copy_heading({}, o);
	const replyNote = m.contact_ack_reply_note({}, o);
	const signoff = m.contact_ack_signoff({}, o);
	const interestLabelText = m.contact_field_interest_label({}, o);
	const messageLabelText = m.contact_field_message_label({}, o);
	const interest = sub.interest ? interestMessage(sub.interest as Interest, locale) : null;

	// --- text/plain ---
	const echo: string[] = [];
	if (interest) echo.push(`${interestLabelText}: ${interest}`);
	echo.push(`${messageLabelText}:\n${sub.message}`);
	const text = [
		m.contact_ack_greeting({ name: sub.name }, o),
		'',
		body,
		'',
		copyHeading,
		'',
		echo.join('\n\n'),
		'',
		replyNote,
		'',
		signoff
	].join('\n');

	// --- text/html (escape every dynamic value; the Paraglide prose is trusted) ---
	const greetingHtml = m.contact_ack_greeting({ name: escapeHtml(sub.name) }, o);
	const echoHtml =
		(interest
			? `<p style="margin:0 0 12px"><strong>${interestLabelText}:</strong> ${interest}</p>`
			: '') +
		`<p style="margin:0 0 4px"><strong>${messageLabelText}:</strong></p>` +
		`<p style="margin:0;white-space:pre-wrap">${escapeHtml(sub.message)}</p>`;
	const html =
		`<div style="font:14px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">` +
		`<p>${greetingHtml}</p>` +
		`<p>${body}</p>` +
		`<p style="color:#64748b;margin-bottom:8px">${copyHeading}</p>` +
		`<blockquote style="margin:0;padding:12px 16px;border-left:3px solid #cbd5e1;background:#f8fafc">${echoHtml}</blockquote>` +
		`<p>${replyNote}</p>` +
		`<p style="color:#64748b">${signoff}</p>` +
		`</div>`;

	return {
		from: ACK_FROM,
		to: sub.email,
		replyTo: CONTACT_EMAIL,
		subject,
		text,
		html,
		headers: AUTO_REPLY_HEADERS
	};
}

/**
 * POST one email to Resend. Throws on a non-2xx response so the caller can log it.
 */
async function postEmail(apiKey: string, email: OutboundEmail): Promise<void> {
	const res = await fetch(RESEND_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from: email.from,
			to: email.to,
			reply_to: email.replyTo,
			subject: email.subject,
			text: email.text,
			html: email.html,
			...(email.headers ? { headers: email.headers } : {})
		})
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Resend responded ${res.status}${detail ? `: ${detail}` : ''}`);
	}
}

/**
 * Send both contact emails (internal lead + submitter ack). Two INDEPENDENT sends, not
 * a Resend batch: the lead is the important message and must not be lost if the ack
 * fails — the ack goes to an unverified, caller-supplied address that could bounce or
 * 4xx. `allSettled` so one failure is logged (by role, never the recipient address —
 * no PII in logs) without dropping the other. The caller schedules this via
 * `ctx.waitUntil`, so it runs after the response and never blocks the visitor.
 */
export async function sendContactEmails(
	apiKey: string,
	sub: CleanedContact,
	locale: Locale
): Promise<void> {
	// Build INSIDE each async thunk (not in the array literal) so a synchronous *builder*
	// throw — not just a send failure — is captured per-email by allSettled. Otherwise a
	// throw in buildAckEmail would abort before allSettled and take the lead down with it,
	// breaking the "lead survives an ack failure" invariant above.
	const senders: [role: string, send: () => Promise<void>][] = [
		['lead', async () => postEmail(apiKey, buildLeadEmail(sub))],
		['ack', async () => postEmail(apiKey, buildAckEmail(sub, locale))]
	];
	const results = await Promise.allSettled(senders.map(([, send]) => send()));
	results.forEach((r, i) => {
		if (r.status === 'rejected') {
			console.error(`contact ${senders[i][0]} email failed`, r.reason);
		}
	});
}
