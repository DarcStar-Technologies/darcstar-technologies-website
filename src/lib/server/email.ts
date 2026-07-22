// Shared transactional-email primitives (Resend over plain HTTPS `fetch` — no npm SDK, so the
// Worker stays lean and these stay pure/unit-testable). Two senders build on this: the contact
// fan-out (contact-notify.ts) and the sign-up verification email (verification-email.ts). Provider:
// Resend (https://resend.com), reachable from workerd via fetch. All copy/escaping lives in the
// callers; this module only knows the wire shape + the POST.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface OutboundEmail {
	from: string;
	to: string;
	replyTo: string;
	subject: string;
	text: string;
	html: string;
	headers?: Record<string, string>;
}

// Escape the HTML-significant chars so caller-supplied content can't break out of — or inject
// markup into — an HTML body. The text/plain part needs no escaping.
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * POST one email to Resend. Throws on a non-2xx response so the caller can log it (contact sends
 * are fire-and-forget via ctx.waitUntil; the verification send is awaited inside Better Auth's
 * background task). Maps our camelCase `replyTo`/`headers` onto Resend's wire field names.
 */
export async function postEmail(apiKey: string, email: OutboundEmail): Promise<void> {
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
