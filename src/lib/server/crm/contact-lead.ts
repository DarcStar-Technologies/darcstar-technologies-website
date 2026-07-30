// Contact-form submissions become CRM signals (DAR-136).
//
// One producer, declared in `crm-egress.spec.ts`. It carries a name, an email address and a company
// and NOTHING ELSE — see `contact-signal.ts` on why the absent fields are the point, and
// `privacy_processors_twenty_body`, which is the public promise this shape keeps.
//
// POSTURE: identical to the Resend fan-out beside it in `contact.remote.ts`. The row is committed
// before this runs, so a queue failure must never fail the submission — it is logged and dropped.
// A missed produce is also not the disaster it would be if the queue were the only path: the CRM's
// reconcile sweep re-reads `contact_submission` and stays authoritative over the queue (DAR-135), so
// this is an accelerator rather than the system of record.
import { emailIdentity, CONTACT_SIGNAL_VERSION, type ContactSignal } from './contact-signal';
import { postContactSignal } from './queue';

/** What a committed `contact_submission` row contributes to the contact graph. */
export interface ContactLead {
	/** The row's id. Becomes `sourceRef`, hence the idempotency key — never a fresh uuid. */
	submissionId: string;
	/** The row's own `created_at`, NOT the time this produce happens to run. */
	createdAt: Date;
	name: string;
	email: string;
	company: string | null;
}

/**
 * Build the signal for one submission. Pure, so the wire shape is unit-testable without a queue.
 *
 * `occurredAt` comes from the ROW, because the contract asks for when the source observed the signal
 * rather than when it was enqueued — and those differ by however long `ctx.waitUntil` takes to get
 * around to it, or by a whole redelivery. Taking the committed timestamp makes the distinction free.
 *
 * An empty `company` is OMITTED rather than sent as `''`: the consumer fills empty fields on an
 * existing contact, so a blank string is a value that could overwrite a real company with nothing.
 */
export function buildContactLeadSignal(lead: ContactLead): ContactSignal {
	const company = lead.company?.trim();
	const name = lead.name.trim();
	// One identity, built once: `email` is a MIRROR of it, so deriving the two independently would be
	// two chances to normalize differently — and the consumer matches identities by exact string.
	const identity = emailIdentity(lead.email);
	return {
		v: CONTACT_SIGNAL_VERSION,
		source: 'website_form',
		sourceRef: lead.submissionId,
		occurredAt: lead.createdAt.toISOString(),
		createdBy: 'system:website_form',
		identities: [identity],
		email: identity.externalId,
		...(name ? { displayName: name } : {}),
		...(company ? { company } : {})
	};
}

/**
 * Hand one submission to the CRM, fire-and-forget.
 *
 * Returns `void` for the reason `captureWaitlistFunnel` does (DAR-66): there is no caller that
 * should be able to await this, and a return value invites one to try. Everything that can go
 * wrong — no binding, a queue that refuses, no `ctx` to keep the Worker alive — resolves to "the
 * submission still succeeded".
 */
export function captureContactLead(platform: App.Platform | undefined, lead: ContactLead): void {
	// No binding check here on purpose — `postContactSignal` owns the binding (it is the only file
	// that may name it) and answers `'skipped'` when there is none. Duplicating the test would be a
	// second place that has to know the preview Worker has no queue.
	//
	// THE BUILD IS INSIDE THE PROMISE, not just the send, and that is the difference between "nothing
	// here fails the submission" being structural and being a property of today's inputs.
	// `buildContactLeadSignal` reads `lead.createdAt.toISOString()`, so a caller that handed over a
	// row whose timestamp was not a `Date` would throw SYNCHRONOUSLY — straight out of this function,
	// past the `.catch`, and into a submission whose row is already committed. A 500 on a lead we
	// just saved successfully is the one outcome this whole path exists to prevent, so it must not be
	// reachable by getting a caller wrong. (Measured: drizzle does hand back a real `Date` for the
	// SQL-default `created_at`, so this guards a future caller rather than a live bug.)
	const produce = Promise.resolve()
		.then(() => postContactSignal(platform, buildContactLeadSignal(lead)))
		.catch((err) =>
			// The submission id, never the email: this line goes to Workers Logs, and the row it names
			// is enough to replay the signal by hand.
			console.error(`crm ingest produce failed for submission ${lead.submissionId}`, err)
		);
	platform?.ctx?.waitUntil(produce);
}
