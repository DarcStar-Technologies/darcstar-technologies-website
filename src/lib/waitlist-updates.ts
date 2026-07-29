// Where an address stands on product-and-research updates (DAR-139) — the client-safe half. Only the
// vocabulary and the rule that turns three timestamps into one state live here, because /admin/waitlist
// renders a badge; everything that touches the database is in waitlist-store.ts. Same split as
// $lib/waitlist-invite.ts and the DAR-66 funnel modules.
//
// WHAT THIS IS FOR. `waitlist_submission.consent_updates` is an unverified single-opt-in claim from an
// unauthenticated form — anyone can type someone else's address in and tick the box — so it has never
// been permission to send, and /privacy says so in public (DAR-121). These states are the gate that
// turns a tick into permission: `asked` is a question we put to the mailbox, `confirmed` is that
// mailbox's answer, and `unsubscribed` takes it back for good.

/** In progression order, which is also the order the admin badge escalates. */
export const WAITLIST_UPDATES_STATES = ['none', 'asked', 'confirmed', 'unsubscribed'] as const;
export type WaitlistUpdatesState = (typeof WAITLIST_UPDATES_STATES)[number];

/** The three lead columns the state is derived from. Nulls are the norm — most leads have all three. */
export interface WaitlistUpdatesSignals {
	updatesConfirmSentAt: Date | null;
	updatesConfirmedAt: Date | null;
	updatesUnsubscribedAt: Date | null;
}

/**
 * Which of the four states a lead is in.
 *
 * WITHDRAWAL IS CHECKED FIRST, and the order is load-bearing rather than tidy — the same way
 * `waitlistInviteState` has to test activation before invitation. A withdrawn lead almost always has a
 * `updates_confirmed_at` too (you unsubscribe from something you joined), and that timestamp is kept
 * on purpose as the audit trail of what happened, so testing confirmation first would report every
 * opted-out address as still subscribed — the one wrong answer here that costs somebody an email they
 * asked us not to send.
 *
 * Derived, never stored: a pure function of columns already on the row, so a persisted copy would only
 * add a migration and an obligation to recompute it on every write (DAR-65's rule for the lead class,
 * DAR-67's for the invite state).
 */
export function waitlistUpdatesState(row: WaitlistUpdatesSignals): WaitlistUpdatesState {
	if (row.updatesUnsubscribedAt !== null) return 'unsubscribed';
	if (row.updatesConfirmedAt !== null) return 'confirmed';
	if (row.updatesConfirmSentAt !== null) return 'asked';
	return 'none';
}

/**
 * May we send this address a product-or-research update?
 *
 * THE WHOLE GATE, in one expression, and the only definition of it — `readUpdatesAudience`
 * (waitlist-store.ts) is the same rule written as a `WHERE`, and `waitlist-store.spec.ts` runs a table
 * of leads through both and requires them to agree, because two encodings of one rule cannot be
 * single-sourced when one of them is SQL (DAR-71's move for the `noIndex` rule).
 *
 * Note what it does NOT read: `consent_updates`. A ticked box is a request to be asked, and the answer
 * is `updates_confirmed_at` or nothing.
 *
 * HONEST RESIDUAL: nothing forces a future sender to call this. What removes the SILENT path is
 * `email-senders.spec.ts`, which fails until a new mailer is declared and puts this function's name in
 * front of whoever declares it.
 */
export const mayReceiveUpdates = (row: WaitlistUpdatesSignals): boolean =>
	waitlistUpdatesState(row) === 'confirmed';
