// Waitlist emails — every accepted signup fans out to two messages, sent fire-and-forget from
// joinWaitlist (src/lib/waitlist.remote.ts), exactly like the contact flow (contact-notify.ts):
//   1. Lead notification → the monitored info@ inbox (plain English ops output, outside the
//      no-raw-text rule).
//   2. Signer acknowledgement → the (validated) address, a warm "you're on the list" confirmation.
//      User-facing, so its copy is Paraglide, localized to the request locale.
//
// The row is already persisted before either send, so a failure is logged, never surfaced. Wire
// primitives (OutboundEmail/escapeHtml/postEmail) live in email.ts, shared with the contact + sign-up
// senders. Unlike the contact ack, the waitlist ack does NOT echo the form back — a signup
// confirmation just needs to say "you're in", so it stays short and low-friction.
import type { CleanedWaitlist } from './waitlist';
import type { WaitlistRole } from '$lib/waitlist-roles';
import type { WaitlistCompanySize } from '$lib/waitlist-company-sizes';
import type { WaitlistReferralSource } from '$lib/waitlist-referral-sources';
import type { Locale } from '$lib/paraglide/runtime';
import { CONTACT_EMAIL, SITE_NAME } from '$lib/site';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, escapeHtml, postEmail } from './email';

// Both messages send FROM the Resend-verified role alias (single-sourced from site.ts). The lead
// lands in info@ with Reply-To set to the signer; the ack goes to the signer with Reply-To to info@.
const LEAD_FROM = `DarcStar Waitlist <${CONTACT_EMAIL}>`;
const ACK_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;

// RFC 3834 auto-reply headers (ack only) — keep an out-of-office responder from replying and opening
// a mail loop. Same rationale + choices as contact-notify.ts (no `Precedence: bulk`).
const AUTO_REPLY_HEADERS: Record<string, string> = {
	'Auto-Submitted': 'auto-replied',
	'X-Auto-Response-Suppress': 'All'
};

// Slug → English label maps for the LEAD email (server ops output, always English). Keyed on the
// slug unions so adding a slug without a label is a compile error, not a silent gap. `interest` has
// no map — it's free text, echoed verbatim.
const ROLE_LABELS: Record<WaitlistRole, string> = {
	founder: 'Founder / Executive',
	engineering: 'Engineering',
	product: 'Product',
	research: 'Research / Science',
	operations: 'Operations',
	investor: 'Investor',
	student: 'Student',
	other: 'Other'
};
const COMPANY_SIZE_LABELS: Record<WaitlistCompanySize, string> = {
	solo: 'Just me',
	'2-10': '2–10',
	'11-50': '11–50',
	'51-200': '51–200',
	'201-1000': '201–1000',
	'1000-plus': '1000+'
};
const REFERRAL_LABELS: Record<WaitlistReferralSource, string> = {
	search: 'Search',
	social: 'Social media',
	'word-of-mouth': 'Word of mouth',
	event: 'Event / conference',
	news: 'News / article',
	other: 'Other'
};

const NOT_PROVIDED = 'Not provided';
const roleLabel = (v: string | null) => (v ? (ROLE_LABELS[v as WaitlistRole] ?? v) : NOT_PROVIDED);
const sizeLabel = (v: string | null) =>
	v ? (COMPANY_SIZE_LABELS[v as WaitlistCompanySize] ?? v) : NOT_PROVIDED;
const referralLabel = (v: string | null) =>
	v ? (REFERRAL_LABELS[v as WaitlistReferralSource] ?? v) : NOT_PROVIDED;

/** Render a signup into the internal lead email. Pure — unit-tested. */
export function buildWaitlistLeadEmail(sub: CleanedWaitlist): OutboundEmail {
	const subject = `New waitlist signup: ${sub.email}`;

	const rows: [label: string, value: string][] = [
		['Email', sub.email],
		['Name', sub.name ?? NOT_PROVIDED],
		['Company', sub.company ?? NOT_PROVIDED],
		['Role', roleLabel(sub.role)],
		['Company size', sizeLabel(sub.companySize)],
		['Interest', sub.interest ?? NOT_PROVIDED],
		['Heard via', referralLabel(sub.hearAbout)],
		['Phone', sub.phone ?? NOT_PROVIDED]
	];

	const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
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
 * Render the signer-facing "you're on the list" acknowledgement. Pure — unit-tested. Copy is
 * Paraglide, resolved for `locale`; the name (if given) is HTML-escaped in the html body. A generic
 * greeting is used when no name was provided (name is optional on the waitlist).
 */
export function buildWaitlistAckEmail(sub: CleanedWaitlist, locale: Locale): OutboundEmail {
	const o = { locale };
	const subject = m.waitlist_ack_subject({}, o);
	const greeting = sub.name
		? m.waitlist_ack_greeting_named({ name: sub.name }, o)
		: m.waitlist_ack_greeting_generic({}, o);
	const body = m.waitlist_ack_body({}, o);
	const signoff = m.waitlist_ack_signoff({}, o);

	const text = [greeting, '', body, '', signoff].join('\n');

	const greetingHtml = sub.name
		? m.waitlist_ack_greeting_named({ name: escapeHtml(sub.name) }, o)
		: m.waitlist_ack_greeting_generic({}, o);
	const html =
		`<div style="font:14px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">` +
		`<p>${greetingHtml}</p>` +
		`<p>${body}</p>` +
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
 * Send both waitlist emails (internal lead + signer ack). Two INDEPENDENT sends, not a Resend batch:
 * the lead must survive an ack failure (the ack goes to a caller-supplied address that could bounce).
 * `allSettled` so one failure is logged by role (never the recipient address — no PII in logs)
 * without dropping the other. The caller schedules this via `ctx.waitUntil` (runs after the response).
 */
export async function sendWaitlistEmails(
	apiKey: string,
	sub: CleanedWaitlist,
	locale: Locale
): Promise<void> {
	// Build INSIDE each thunk so a synchronous builder throw is captured per-email by allSettled
	// (see contact-notify.ts for why — preserves "lead survives an ack failure").
	const senders: [role: string, send: () => Promise<void>][] = [
		['lead', async () => postEmail(apiKey, buildWaitlistLeadEmail(sub))],
		['ack', async () => postEmail(apiKey, buildWaitlistAckEmail(sub, locale))]
	];
	const results = await Promise.allSettled(senders.map(([, send]) => send()));
	results.forEach((r, i) => {
		if (r.status === 'rejected') {
			console.error(`waitlist ${senders[i][0]} email failed`, r.reason);
		}
	});
}
