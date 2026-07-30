// THE ONE ROUTE OUT to the CRM (DAR-136). Nothing else in this repo may touch `CRM_INGEST`.
//
// This is `email.ts`'s role for a second egress: that module is the only file that reaches the mail
// provider, which is what makes "who may send email" a question with an answer (DAR-121). The same
// now holds for personal data leaving this Worker toward the contact graph — and it matters more
// here than it looks, because the consumer forwards every resolved contact to Twenty, a processor
// `/privacy` names. A second, undeclared produce would put a new category of personal data in front
// of a third party with nothing in a diff to show it. `crm-egress.spec.ts` pins both halves: this
// file is the sole caller of `.send()`, and only declared modules may import the function below.
//
// WHY A QUEUE AND NOT A SERVICE BINDING (DAR-34's choice, restated because it constrains this file):
// the write has to survive the CRM being down, and `ctx.waitUntil` only extends ~30s past the
// response. An RPC into an unhealthy CRM inside that budget is a lost signal; an enqueued message is
// not. So this module's contract is "hand it to the queue and stop caring" — it deliberately knows
// nothing about whether the CRM is healthy, and there is nothing here to retry, because the queue's
// own redelivery plus a DLQ with a drain plan is that (all consumer-side, DAR-135).
import type { ContactSignal } from './contact-signal';

/** Whether the message was handed to the queue, or there was no queue to hand it to. */
export type ProduceOutcome = 'sent' | 'skipped';

/**
 * Enqueue one signal.
 *
 * TAKES `platform` AND RESOLVES THE BINDING ITSELF, rather than being handed a `Queue`. That is what
 * makes the chokepoint real: `CRM_INGEST` is the only handle on the queue that exists, so "this file
 * is the only one that names it" (pinned in `crm-egress.spec.ts`) is a stronger statement than
 * "this file is the only one that calls `.send()`" — a caller that resolved the binding for itself
 * would satisfy the second and walk straight past the first.
 *
 * THE BINDING IS GENUINELY ABSENT in the preview Worker, by design: `wrangler.jsonc` declares it in
 * production only, since there is no `crm-ingest-preview` to point at and aiming preview at the real
 * queue would put test submissions in the real contact graph. Declaring it in one env is also what
 * makes `pnpm gen` type it `CRM_INGEST?: Queue` (measured), so handling absence is not a defensive
 * `if` bolted onto a value the types call certain — it is the shape the generated types hand us.
 *
 * Absence is therefore a SKIP, never a failure: a preview submission persists to
 * `contact_submission` and simply never reaches the CRM, which is what should happen to test data.
 * A local `wrangler dev` (which is what `pnpm preview` and the e2e run) resolves a SIMULATED queue —
 * wrangler's default is local mode and nothing here passes `--remote` — so a development submit
 * enqueues nothing that leaves the machine.
 *
 * Rejects if the queue itself refuses the message, so the caller can log it. Nothing upstream may
 * turn that into a failed submission — the row is already committed by the time this runs.
 */
export async function postContactSignal(
	platform: App.Platform | undefined,
	signal: ContactSignal
): Promise<ProduceOutcome> {
	const queue = platform?.env?.CRM_INGEST;
	if (!queue) return 'skipped';
	await queue.send(signal);
	return 'sent';
}
