// Contact-form submission (issue #11) — a SvelteKit remote `form` function, so it
// works as a progressively-enhanced POST and is called via `<form {...submitContact}>`
// in ContactDialog.svelte. Lives in $lib (allowed) — remote functions may sit
// anywhere under src EXCEPT $lib/server.
import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';
import { hashIp, validateContact } from '$lib/server/contact';
import { sendContactEmails } from '$lib/server/contact-notify';
import { captureContactLead } from '$lib/server/crm/contact-lead';
import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime';

// Abuse throttle: at most THROTTLE_MAX submissions per hashed IP per window.
const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MAX = 5;

type ContactInput = {
	name: string;
	email: string;
	company: string;
	interest: string;
	message: string;
	website: string; // honeypot — must stay empty
};

export const submitContact = form<ContactInput, { success: true }>(
	'unchecked',
	async (data, issue) => {
		// Grab request-scoped handles FIRST (before any await): on workerd
		// `platform.env` is only valid during the request and getRequestEvent()
		// must be called before the first await. getDb() reads it synchronously.
		const db = getDb();
		const event = getRequestEvent();
		const ip = event.getClientAddress();
		const userAgent = event.request.headers.get('user-agent') ?? null;
		// Captured before the first await (workerd platform is request-scoped) for the
		// notification sends scheduled after the insert. `locale` localizes the submitter
		// ack; note the remote POST may not carry the URL locale, so this can resolve to
		// the base locale — harmless while `es` is untranslated (it falls back to `en`),
		// but thread an explicit locale (hidden field) here once Spanish is real.
		const platform = event.platform;
		const locale = getLocale();
		// If a signed-in visitor submits, tie the row to their account (#96) so it shows under
		// /account. `locals.user` is populated by hooks.server.ts whenever a session cookie is present
		// (the common anonymous lead carries none → stays null). Read before the first await.
		const userId = event.locals.user?.id ?? null;

		// Honeypot: humans never fill the hidden `website` field; bots do. Silently
		// accept (don't persist, don't reveal the trap).
		if (typeof data.website === 'string' && data.website.trim() !== '') {
			return { success: true };
		}

		const { ok, cleaned, errors } = validateContact(data);
		if (!ok) {
			const issues = [];
			if (errors.includes('name')) issues.push(issue.name(m.contact_error_name()));
			if (errors.includes('email')) issues.push(issue.email(m.contact_error_email()));
			if (errors.includes('message')) issues.push(issue.message(m.contact_error_message()));
			invalid(...issues); // throws; fields.*.issues() populate client-side
		}

		// Light IP/time throttle (honeypot handles most bots; this caps floods).
		const ipHash = await hashIp(ip);
		const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
		const recent = await db
			.select({ id: contactSubmission.id })
			.from(contactSubmission)
			.where(and(eq(contactSubmission.ipHash, ipHash), gt(contactSubmission.createdAt, since)));
		if (recent.length >= THROTTLE_MAX) invalid(m.contact_error_ratelimit());

		// `returning` because the CRM signal below needs this row's own id and timestamp: the id is
		// the idempotency key the consumer dedupes redeliveries on, and `createdAt` is a DB default
		// (`unixepoch`), so re-deriving either here would be a second, subtly different answer.
		const [row] = await db
			.insert(contactSubmission)
			.values({
				name: cleaned.name,
				email: cleaned.email,
				company: cleaned.company,
				interest: cleaned.interest,
				message: cleaned.message,
				ipHash,
				userAgent,
				userId
			})
			.returning({ id: contactSubmission.id, createdAt: contactSubmission.createdAt });

		// Fire-and-forget notifications (issue #52 lead + #92 submitter ack). The row is
		// already persisted, so a send failure must NOT fail the submission — we log and
		// move on. On workerd, ctx.waitUntil keeps the Worker alive until the sends
		// resolve after the response is returned; without a key (unconfigured) or ctx
		// (vite dev) we simply skip. Never awaited — the visitor's response doesn't wait
		// on email. Only reached on the genuine-insert path (past the honeypot + throttle),
		// so the ack can't be turned into an outbound-spam amplifier beyond the IP throttle.
		const resendKey = platform?.env?.RESEND_API_KEY;
		if (resendKey) {
			const send = sendContactEmails(resendKey, cleaned, locale).catch((err) =>
				console.error('contact notifications failed', err)
			);
			if (platform?.ctx) platform.ctx.waitUntil(send);
		}

		// Hand the lead to the CRM (DAR-136) — same never-fail-the-submission contract as the emails
		// above, and for the same reason: the row is already committed. This replaced nothing; the
		// inline `website_form` connector call the ticket describes was never built in this repo, so
		// the site still imports no CRM code. A queue, not a service binding, because the write must
		// survive the CRM being down and `ctx.waitUntil` only extends ~30s past this response.
		//
		// Reached only on the genuine-insert path — past the honeypot and the throttle — so a bot
		// cannot enqueue, exactly as it cannot trigger the acknowledgement email. The preview Worker
		// declares no queue binding at all, so there this is a silent skip (see wrangler.jsonc). That
		// binding is deliberately not NAMED here: `crm-egress.spec.ts` asserts exactly one source file
		// names it, and while comments are stripped before that scan, source-scan.ts's own rule is that
		// a scanned file must not lean on the stripper to stay clean.
		// Fields named ONE BY ONE rather than spreading `cleaned`: the guarantee that the message body
		// never leaves for the CRM is worth being able to read here, and a spread would hand it to the
		// producer to be dropped out of sight (`contact-signal.ts` has no field for it either way).
		if (row) {
			captureContactLead(platform, {
				submissionId: row.id,
				createdAt: row.createdAt,
				name: cleaned.name,
				email: cleaned.email,
				company: cleaned.company
			});
		}

		return { success: true };
	}
);
