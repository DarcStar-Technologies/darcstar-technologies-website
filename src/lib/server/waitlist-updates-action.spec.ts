import { describe, expect, it, vi } from 'vitest';
import { runUpdatesAction } from './waitlist-updates-action';
import type { Db } from './db';
import type { WaitlistSigningSecret } from './waitlist-secret';
import type { WaitlistUpdatesSignals } from '$lib/waitlist-updates';

// What both DAR-139 landing pages do when the button is pressed. The two properties worth pinning here
// are the refusals: every way of failing collapses to ONE generic answer (so a page reached from an
// email cannot become a "does this address exist?" oracle), and nothing mutates on a GET.

const SECRET = 'test-secret-not-a-real-one' as WaitlistSigningSecret;
// The db is never reached in the refusal cases, and in the others it is only handed to `write`, which
// is a stub. Nothing here needs a real client, so a cast states that rather than standing up libsql —
// waitlist-store.spec.ts is where the SQL itself is exercised.
const DB = {} as Db;

const CONFIRMED: WaitlistUpdatesSignals = {
	updatesConfirmSentAt: new Date('2026-07-01'),
	updatesConfirmedAt: new Date('2026-07-02'),
	updatesUnsubscribedAt: null
};

const verifies = (leadId: string | null) => vi.fn().mockResolvedValue(leadId);
const writes = (result: WaitlistUpdatesSignals | null) => vi.fn().mockResolvedValue(result);

const env = (over: Partial<Parameters<typeof runUpdatesAction>[0]> = {}) => ({
	db: DB,
	secret: SECRET as WaitlistSigningSecret | undefined,
	method: 'POST',
	...over
});

describe('runUpdatesAction', () => {
	it('reports the state the write left behind', async () => {
		const write = writes(CONFIRMED);
		const result = await runUpdatesAction(env(), 'c1.lead.999.mac', verifies('lead-1'), write);
		expect(result).toBe('confirmed');
		expect(write).toHaveBeenCalledWith(DB, 'lead-1');
	});

	// THE DOUBLE OPT-IN PROPERTY, as a runtime guard rather than a convention about where the call
	// sits. Mail scanners fetch every link in an inbound message, so a confirmation reachable from a
	// GET is confirmed by a machine on delivery — and "only call this from an action" is exactly the
	// kind of rule a future `load` breaks silently.
	it.each(['GET', 'HEAD', 'OPTIONS'])(
		'refuses a %s and never reaches the write',
		async (method) => {
			const verify = verifies('lead-1');
			const write = writes(CONFIRMED);
			expect(await runUpdatesAction(env({ method }), 'c1.lead.999.mac', verify, write)).toBe(
				'invalid'
			);
			// Before the verification too — a misplaced call costs no HMAC and no query.
			expect(verify).not.toHaveBeenCalled();
			expect(write).not.toHaveBeenCalled();
		}
	);

	// EVERY FAILURE IS ONE ANSWER. Each row here is a different cause, and telling them apart is what
	// would turn a page anyone can reach into an oracle over addresses we hold.
	it.each([
		{ why: 'the deploy has no signing secret', over: { secret: undefined }, lead: 'lead-1' },
		{ why: 'the token does not verify', over: {}, lead: null }
	])('answers invalid when $why', async ({ over, lead }) => {
		const write = writes(CONFIRMED);
		expect(await runUpdatesAction(env(over), 'whatever', verifies(lead), write)).toBe('invalid');
		expect(write).not.toHaveBeenCalled();
	});

	// A verified token whose lead is gone. Folded into the same answer deliberately: it is the one
	// branch that would otherwise separate "this address was deleted" from "this link is stale".
	it('answers invalid for a verified token whose lead no longer exists', async () => {
		const result = await runUpdatesAction(
			env(),
			'c1.lead.999.mac',
			verifies('lead-1'),
			writes(null)
		);
		expect(result).toBe('invalid');
	});

	// The ONE failure that is not folded in, and the reason is asymmetric: telling somebody their
	// withdrawal went through when the write threw is the worst answer these pages can give.
	it('answers error — not invalid — when the write throws', async () => {
		const boom = vi.fn().mockRejectedValue(new Error('turso is having a day'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const result = await runUpdatesAction(env(), 'c1.lead.999.mac', verifies('lead-1'), boom);
			expect(result).toBe('error');
			// Logged without the lead id or the address — these logs are read far from the person.
			const logged = JSON.stringify(spy.mock.calls);
			expect(logged).not.toContain('lead-1');
		} finally {
			spy.mockRestore();
		}
	});
});
