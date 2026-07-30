import { describe, expect, it } from 'vitest';
import {
	WAITLIST_UPDATES_STATES,
	mayReceiveUpdates,
	waitlistUpdatesState,
	type WaitlistUpdatesSignals
} from './waitlist-updates';

// DAR-139. The gate /privacy promises: a ticked box is a request to be asked, and only a click from the
// mailbox is permission to send. These tests are about the ORDER the three timestamps are read in, which
// is where the one costly mistake lives — see the withdrawal cases.

const at = (iso: string) => new Date(iso);
const lead = (over: Partial<WaitlistUpdatesSignals> = {}): WaitlistUpdatesSignals => ({
	updatesConfirmSentAt: null,
	updatesConfirmedAt: null,
	updatesUnsubscribedAt: null,
	...over
});

describe('waitlistUpdatesState', () => {
	it('reads an untouched lead as none', () => {
		expect(waitlistUpdatesState(lead())).toBe('none');
	});

	it('reads a lead we have asked but who has not answered as asked', () => {
		expect(waitlistUpdatesState(lead({ updatesConfirmSentAt: at('2026-07-01') }))).toBe('asked');
	});

	it('reads a lead whose mailbox clicked confirm as confirmed', () => {
		const state = waitlistUpdatesState(
			lead({ updatesConfirmSentAt: at('2026-07-01'), updatesConfirmedAt: at('2026-07-02') })
		);
		expect(state).toBe('confirmed');
	});

	// THE CASE THE ORDERING EXISTS FOR. A withdrawn lead keeps its `updates_confirmed_at` — that is the
	// audit trail of what happened, deliberately not cleared — so a rule that tested confirmation first
	// would report every opted-out address as still subscribed. That is the one wrong answer here that
	// costs somebody mail they asked us not to send.
	it('reads a withdrawal as unsubscribed even though the confirmation timestamp survives it', () => {
		const row = lead({
			updatesConfirmSentAt: at('2026-07-01'),
			updatesConfirmedAt: at('2026-07-02'),
			updatesUnsubscribedAt: at('2026-07-03')
		});
		expect(row.updatesConfirmedAt).not.toBeNull();
		expect(waitlistUpdatesState(row)).toBe('unsubscribed');
	});

	// Reachable, and not a curiosity: the confirmation request carries a "don't ask again" link, so
	// somebody whose address a stranger typed in withdraws WITHOUT ever having confirmed anything.
	it('reads a withdrawal with no confirmation behind it as unsubscribed', () => {
		const row = lead({
			updatesConfirmSentAt: at('2026-07-01'),
			updatesUnsubscribedAt: at('2026-07-01')
		});
		expect(waitlistUpdatesState(row)).toBe('unsubscribed');
	});

	// The vocabulary is what the badge renders and what the store's audience query is checked against;
	// an entry appearing or vanishing should be a deliberate edit, not a side effect.
	it('has exactly the four states the badge and the audience rule share', () => {
		expect([...WAITLIST_UPDATES_STATES]).toEqual(['none', 'asked', 'confirmed', 'unsubscribed']);
	});
});

describe('mayReceiveUpdates', () => {
	// One row per state, so the predicate is pinned across the whole vocabulary rather than at the two
	// ends of it — `asked` is the state a naive "have we been in touch?" check would wrongly admit, and
	// it is also the state most leads with a ticked box are actually in.
	it.each([
		{ state: 'none', row: lead(), may: false },
		{ state: 'asked', row: lead({ updatesConfirmSentAt: at('2026-07-01') }), may: false },
		{
			state: 'confirmed',
			row: lead({ updatesConfirmSentAt: at('2026-07-01'), updatesConfirmedAt: at('2026-07-02') }),
			may: true
		},
		{
			state: 'unsubscribed',
			row: lead({
				updatesConfirmSentAt: at('2026-07-01'),
				updatesConfirmedAt: at('2026-07-02'),
				updatesUnsubscribedAt: at('2026-07-03')
			}),
			may: false
		}
	])('$state → $may', ({ row, may }) => {
		expect(mayReceiveUpdates(row)).toBe(may);
	});

	// Exactly one state authorizes a send. Stated as a sweep so adding a fifth state cannot quietly
	// widen the audience — a new entry defaults to "not allowed to receive mail" or this fails.
	it('admits exactly one of the four states', () => {
		const admitted = WAITLIST_UPDATES_STATES.filter((state) =>
			mayReceiveUpdates(
				lead({
					updatesConfirmSentAt: state === 'none' ? null : at('2026-07-01'),
					updatesConfirmedAt:
						state === 'confirmed' || state === 'unsubscribed' ? at('2026-07-02') : null,
					updatesUnsubscribedAt: state === 'unsubscribed' ? at('2026-07-03') : null
				})
			)
		);
		expect(admitted).toEqual(['confirmed']);
	});
});
