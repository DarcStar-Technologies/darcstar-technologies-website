// Invite state for a waitlist row (DAR-67) — the client-safe half. Only the vocabulary and the rule
// that turns two timestamps into one state live here, because the admin table needs to render a badge
// and the invite action needs to decide "invite" vs "resend"; everything that touches the database is
// in $lib/server/waitlist-invite.ts, same split as the DAR-66 funnel modules.

/** In progression order, which is also the order the badge colours escalate. */
export const WAITLIST_INVITE_STATES = ['not-invited', 'invited', 'activated'] as const;
export type WaitlistInviteState = (typeof WAITLIST_INVITE_STATES)[number];

/** The two columns the state is derived from. Accepts nulls — most rows have both. */
export interface WaitlistInviteSignals {
	invitedAt: Date | null;
	activatedAt: Date | null;
}

/**
 * Which of the three states a row is in.
 *
 * ACTIVATION WINS over invitation, and the order matters rather than being a tidy-up: an activated
 * row necessarily also has an `invited_at` (auth.ts's onPasswordReset stamp refuses to fire without
 * one), so checking `invitedAt` first would report every activated prospect as merely invited and the
 * badge would never reach its final state.
 *
 * Derived, never stored — like DAR-65's lead class, it is a pure function of columns already on the
 * row, so a persisted copy would only add a migration and an obligation to recompute it on every
 * write. It is also why `activated` can't drift out of sync with the account: the timestamp IS the
 * record of the password having been set.
 */
export function waitlistInviteState(row: WaitlistInviteSignals): WaitlistInviteState {
	if (row.activatedAt !== null) return 'activated';
	if (row.invitedAt !== null) return 'invited';
	return 'not-invited';
}

/**
 * Does sending to this row need the "you are doing this again" confirmation?
 *
 * True for anything already invited. A second invitation is not a no-op — it lands another email in a
 * prospect's inbox and invalidates nothing — so DAR-67 requires it to be deliberate rather than a
 * second click on the same button. (An already-ACTIVATED row counts too: mailing a set-password link
 * to someone who has finished onboarding is the most confusing send of the three.)
 */
export function isWaitlistResend(state: WaitlistInviteState): boolean {
	return state !== 'not-invited';
}
