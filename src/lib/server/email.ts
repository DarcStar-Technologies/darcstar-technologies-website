// Shared transactional-email primitives (Resend over plain HTTPS `fetch` — no npm SDK, so the
// Worker stays lean and these stay pure/unit-testable). Provider: Resend (https://resend.com),
// reachable from workerd via fetch. All copy/escaping lives in the callers; this module knows the
// wire shape, the POST, and — for the two fan-outs that send a pair — how independent sends relate
// when one of them fails. Layout for the transactional link emails is link-email.ts.
//
// This is the ONLY file that names the provider, which `email-senders.spec.ts` (DAR-121) pins rather
// than assumes: a second route to Resend from anywhere else would make that whole rule beside the
// point. Note it holds callers to a per-file `postEmail(` COUNT, so a shared helper here must never
// wrap the send itself — see `settleSends`.

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

/**
 * Run several INDEPENDENT sends and log whichever fail, without letting one failure drop the others.
 *
 * Both fan-outs (contact-notify.ts, waitlist-notify.ts) send a pair: a lead into info@ and an
 * acknowledgement to a caller-supplied address that could bounce or 4xx. The lead is the message that
 * matters and must survive the ack failing, so this is `allSettled` over two sends rather than a
 * Resend batch. It was written out in both modules — identically, one of them pointing at the other
 * for the reasoning, which is how a subtle invariant ends up documented twice and drifting once.
 *
 * TAKES THUNKS, NOT EMAILS, and that is the load-bearing part: the caller builds INSIDE its thunk, so
 * a *builder* throw is contained per-email rather than only a send failure. Hand this built
 * `OutboundEmail`s instead and a throw in the ack builder happens before the fan-out starts and takes
 * the lead down with it — the exact invariant this exists to hold. It also keeps `postEmail` at the
 * CALL SITE, which `email-senders.spec.ts` counts per file (DAR-121); wrapping the send here would
 * collapse seven declared senders into one and blind that rule.
 *
 * THE `async` ON THE MAP IS NOT DECORATION. `() => Promise<void>` is satisfied by a plain function
 * that returns a promise, so a thunk is free to throw SYNCHRONOUSLY — and a bare
 * `senders.map(([, send]) => send())` lets that throw escape before `allSettled` is ever reached,
 * taking the sibling send down with it and rejecting out of here. Measured, not theorised: the lead
 * did not run. Both call sites happen to use `async` thunks, so nothing reachable does this today,
 * which is exactly why it needs the wrapper — dropping `async` from `async () => postEmail(…)` reads
 * as a no-op tidy-up and would silently reinstate the failure this function exists to prevent. The
 * guarantee is now independent of how the caller writes the thunk. (Both hand-written copies this
 * replaced had the same hole; the refactor is what turned it into a documented promise.)
 *
 * Logs by ROLE, never the recipient address — no PII in logs.
 */
export async function settleSends(
	label: string,
	senders: [role: string, send: () => Promise<void>][]
): Promise<void> {
	const results = await Promise.allSettled(senders.map(async ([, send]) => send()));
	results.forEach((result, i) => {
		if (result.status === 'rejected') {
			console.error(`${label} ${senders[i][0]} email failed`, result.reason);
		}
	});
}
