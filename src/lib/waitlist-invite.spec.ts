import { describe, expect, it } from 'vitest';
import {
	WAITLIST_INVITE_STATES,
	isWaitlistResend,
	waitlistInviteState,
	type WaitlistInviteState
} from './waitlist-invite';

const at = (iso: string) => new Date(iso);

describe('waitlistInviteState', () => {
	it('reads two nulls as not-invited — the state almost every row is in', () => {
		expect(waitlistInviteState({ invitedAt: null, activatedAt: null })).toBe('not-invited');
	});

	it('reads an invite with no activation as invited', () => {
		expect(waitlistInviteState({ invitedAt: at('2026-07-01T00:00:00Z'), activatedAt: null })).toBe(
			'invited'
		);
	});

	// THE ORDERING TEST. Every activated row also carries an `invited_at` (the onPasswordReset stamp
	// refuses to fire without one), so checking `invitedAt` first would report every finished
	// onboarding as merely invited and the badge would never reach its last state.
	it('lets activation win over invitation when both are set', () => {
		expect(
			waitlistInviteState({
				invitedAt: at('2026-07-01T00:00:00Z'),
				activatedAt: at('2026-07-02T00:00:00Z')
			})
		).toBe('activated');
	});

	// Can't happen through the app — `markWaitlistActivated` requires `invited_at IS NOT NULL` — but a
	// hand-edited row shouldn't render as "not invited" while holding an activation timestamp. Report
	// the stronger fact rather than the tidier one.
	it('still reports activated if an activation timestamp appears without an invite', () => {
		expect(waitlistInviteState({ invitedAt: null, activatedAt: at('2026-07-02T00:00:00Z') })).toBe(
			'activated'
		);
	});

	it('only ever returns a state from the published vocabulary', () => {
		const cases: { invitedAt: Date | null; activatedAt: Date | null }[] = [
			{ invitedAt: null, activatedAt: null },
			{ invitedAt: at('2026-07-01T00:00:00Z'), activatedAt: null },
			{ invitedAt: at('2026-07-01T00:00:00Z'), activatedAt: at('2026-07-02T00:00:00Z') }
		];
		for (const row of cases) {
			expect(WAITLIST_INVITE_STATES).toContain(waitlistInviteState(row));
		}
		// The vocabulary is rendered as badges and used as a sort/label key, so no duplicates.
		expect(new Set(WAITLIST_INVITE_STATES).size).toBe(WAITLIST_INVITE_STATES.length);
	});
});

describe('isWaitlistResend', () => {
	// The button's label and the confirmation copy hang off this. Getting it wrong in the permissive
	// direction means a second invitation goes out reading like a first one.
	it('treats anything already invited as a resend', () => {
		expect(isWaitlistResend('not-invited')).toBe(false);
		expect(isWaitlistResend('invited')).toBe(true);
		// Including activated: mailing a set-password link to someone who finished onboarding is the
		// most confusing of the three sends, so it is the last one that should look routine.
		expect(isWaitlistResend('activated')).toBe(true);
	});

	it('covers every state in the vocabulary', () => {
		for (const state of WAITLIST_INVITE_STATES) {
			expect(typeof isWaitlistResend(state as WaitlistInviteState)).toBe('boolean');
		}
	});
});
