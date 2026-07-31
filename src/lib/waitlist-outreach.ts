// Where an address stands on OUTREACH (DAR-191) — the client-safe half, so /admin/waitlist can render
// a badge without reaching into `$lib/server`. Same split as $lib/waitlist-updates.ts and
// $lib/waitlist-invite.ts: the vocabulary and the rule live here, every query lives in
// waitlist-store.ts.
//
// WHAT THIS IS FOR. `waitlist_submission.contact_permission` is an answer on an immutable row, given
// by whoever filled in the form — which under append-only need not be the person whose address it is.
// It authorizes no automated send and nothing reads it but a human and DAR-65's classifier. So a
// person asking us to stop contacting them has never had anywhere to be recorded, and DAR-140 refused
// to fake one by clearing that answer: clearing a claim stops nothing and edits an append-only row.
//
// This is the lead-level fact instead, and it stands to `contact_permission` exactly as DAR-139's
// `updates_confirmed_at` / `updates_unsubscribed_at` stand to `consent_updates`.

/** The one lead column the rule reads. Null for the overwhelming majority of leads. */
export interface WaitlistOutreachSignals {
	doNotContactAt: Date | null;
}

/**
 * May we initiate contact with this person?
 *
 * THE WHOLE RULE, and the only definition of it. Three `WHERE` clauses in waitlist-store.ts are the
 * same rule written as SQL (the invite's lookup and the two conditional-UPDATE claims), and they
 * cannot be single-sourced with this because they are SQL — DAR-71's situation, and DAR-139's for
 * `mayReceiveUpdates` / `readUpdatesAudience` — so `waitlist-store.spec.ts` pins them against each
 * other behaviourally instead.
 *
 * "Initiate" is load-bearing. This suppresses the invitation, the Priority-A notification that exists
 * to prompt one, and the updates confirmation REQUEST — mail we send at a stranger's prompting to an
 * address that has confirmed nothing. It does NOT suppress a product-or-research update the mailbox
 * itself confirmed: that is a grant this person made, revocable in one click from every message, and
 * `mayReceiveUpdates` deliberately never reads this column. Someone who asked for both to stop has
 * both recorded.
 *
 * HONEST RESIDUAL: nothing forces a future outreach surface to call this — DAR-177's waitlist → CRM
 * producer, when it lands, is the next one that will have to. What this buys is that the rule has one
 * home before that author writes it, which is exactly why `readUpdatesAudience` shipped with no caller.
 */
export const mayContactLead = (row: WaitlistOutreachSignals): boolean =>
	row.doNotContactAt === null;
