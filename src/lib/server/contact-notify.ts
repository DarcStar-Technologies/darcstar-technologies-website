// Lead notification (issue #52) — emails each successful contact submission to a
// monitored inbox so leads are actionable without polling the DB. Called
// fire-and-forget from submitContact (src/lib/contact.remote.ts): the row is
// already persisted, so a send failure is logged, never surfaced to the visitor.
//
// Provider: Resend (https://resend.com) — a plain HTTPS API reachable from workerd
// via `fetch`, so no npm SDK (keeps the Worker lean and the payload builder pure).
// From/To are the public info@ role alias (#54); Reply-To is the visitor's address,
// so hitting Reply in the mail client goes straight to the lead. The copy is plain
// English by design: this is internal ops output, not localized UI, so it sits
// outside the no-raw-text rule (which only scopes routes + components anyway).
import type { CleanedContact } from './contact';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// `from` must be on the Resend-verified sending domain; `to` is where leads land.
// Both are the role alias — the real lead address rides on Reply-To.
const FROM = 'DarcStar Contact <info@darcstar.tech>';
const TO = 'info@darcstar.tech';

// Slug -> human label, mirroring the contact_interest_* UI copy. A plain map (not
// Paraglide) because this email is server-side ops output, always English.
const INTEREST_LABELS: Record<string, string> = {
	robotics: 'Robotics & control',
	markets: 'Financial markets',
	'formal-methods': 'Formal methods & verification',
	partnership: 'Partnership',
	other: 'Something else'
};

const interestLabel = (slug: string | null): string =>
	(slug ? INTEREST_LABELS[slug] : undefined) ?? 'Not specified';

// Escape the HTML-significant chars so visitor content can't break out of — or
// inject markup into — the HTML body. The text/plain part needs no escaping.
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface LeadEmail {
	subject: string;
	text: string;
	html: string;
	replyTo: string;
}

/** Render a submission into subject + text/html bodies. Pure — unit-tested. */
export function buildLeadEmail(sub: CleanedContact): LeadEmail {
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

	return { subject, text, html, replyTo: sub.email };
}

/**
 * POST the lead to Resend. Throws on a non-2xx response so the caller can log it.
 * The caller schedules this via `ctx.waitUntil`, so a throw never affects the
 * already-persisted submission.
 */
export async function sendLeadNotification(apiKey: string, sub: CleanedContact): Promise<void> {
	const { subject, text, html, replyTo } = buildLeadEmail(sub);
	const res = await fetch(RESEND_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ from: FROM, to: TO, reply_to: replyTo, subject, text, html })
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Resend responded ${res.status}${detail ? `: ${detail}` : ''}`);
	}
}
