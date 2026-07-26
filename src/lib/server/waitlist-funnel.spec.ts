import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { getTableColumns } from 'drizzle-orm';
import * as schema from './db/schema';
import { waitlistFunnelEvent } from './db/schema';
import type { Db } from './db';
import {
	captureWaitlistFunnel,
	readWaitlistFunnelCounts,
	signupConversionRate,
	type WaitlistFunnelCounts
} from './waitlist-funnel';
import { WAITLIST_FUNNEL_EVENTS, type WaitlistFunnelEvent } from '$lib/waitlist-funnel';

// The funnel write path (DAR-66), against a real in-memory libsql — because the two properties worth
// testing are both properties of the DATABASE, not of the TypeScript: the composite primary key is
// what caps a flow's rows, and `onConflictDoNothing` is what makes a replayed submit a no-op instead
// of an error. A mocked client would assert the SQL I wrote rather than what SQLite does with it.
const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema }) as unknown as Db;

// `captureWaitlistFunnel` returns void — that IS its contract, so nothing can accidentally await
// analytics. The seam for a test is `ctx.waitUntil`, which is also how the write survives on
// workerd: collect what it hands over, then drain.
const inflight: Promise<unknown>[] = [];
const platform = {
	ctx: { waitUntil: (promise: Promise<unknown>) => inflight.push(promise) }
} as unknown as App.Platform;
const flush = () => Promise.all(inflight.splice(0));

const rows = () =>
	db
		.select({ flowId: waitlistFunnelEvent.flowId, event: waitlistFunnelEvent.event })
		.from(waitlistFunnelEvent);

const FLOW = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_FLOW = '9c858901-8a57-4791-81fe-4c455b099bc9';

beforeAll(async () => {
	await client.execute(
		`CREATE TABLE waitlist_funnel_event (
			flow_id text NOT NULL,
			event text NOT NULL,
			created_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
			PRIMARY KEY (flow_id, event)
		)`
	);
});

afterAll(() => client.close());

beforeEach(async () => {
	inflight.length = 0;
	await client.execute('DELETE FROM waitlist_funnel_event');
});

describe('the events table', () => {
	// The privacy rule is structural: the table has nowhere to put an IP, a user agent, an email or
	// an answer, so no future writer can start recording one without this failing. DAR-58 keeps the
	// free-text answers (deployment scale, the money questions) internal, and "internal" has to mean
	// they never reach an analytics row either.
	it('has no column that could hold personal data', () => {
		expect(Object.keys(getTableColumns(waitlistFunnelEvent)).sort()).toEqual([
			'createdAt',
			'event',
			'flowId'
		]);
	});
});

describe('captureWaitlistFunnel', () => {
	it('writes one row per event for the flow', async () => {
		captureWaitlistFunnel(db, platform, FLOW, ['waitlist_viewed', 'waitlist_signup_completed']);
		await flush();

		// Compared as a set: row order is the primary key's, not the call's, and nothing depends on it.
		expect(await rows()).toEqual(
			expect.arrayContaining([
				{ flowId: FLOW, event: 'waitlist_viewed' },
				{ flowId: FLOW, event: 'waitlist_signup_completed' }
			])
		);
		expect(await rows()).toHaveLength(2);
	});

	// THE CAP. A replayed submit, a double-click or a bot re-POSTing the same step adds nothing, so a
	// flow is bounded to one row per event and every count stays a count of distinct flows — which is
	// what makes signups/views a conversion rate rather than a ratio of retries.
	it('records an event at most once per flow, however many times it fires', async () => {
		for (let i = 0; i < 5; i++)
			captureWaitlistFunnel(db, platform, FLOW, ['qualification_started']);
		await flush();

		expect(await rows()).toEqual([{ flowId: FLOW, event: 'qualification_started' }]);
	});

	it('keeps flows independent', async () => {
		captureWaitlistFunnel(db, platform, FLOW, ['waitlist_viewed']);
		captureWaitlistFunnel(db, platform, OTHER_FLOW, ['waitlist_viewed']);
		await flush();

		expect(await rows()).toHaveLength(2);
	});

	// A duplicate inside ONE call would make the statement conflict with itself; SQLite would reject
	// the whole insert and the sibling event would be lost with it.
	it('de-dupes within a single call without dropping the other events', async () => {
		captureWaitlistFunnel(db, platform, FLOW, [
			'qualification_completed',
			'qualification_completed',
			'pilot_interest_selected'
		]);
		await flush();

		expect((await rows()).map((r) => r.event).sort()).toEqual([
			'pilot_interest_selected',
			'qualification_completed'
		]);
	});

	it.each([
		['a malformed flow id', 'not-a-uuid'],
		['an empty flow id', ''],
		['a missing flow id', undefined]
	])('writes nothing for %s', async (_label, flowId) => {
		captureWaitlistFunnel(db, platform, flowId, ['waitlist_viewed']);
		await flush();

		expect(await rows()).toEqual([]);
	});

	it('writes nothing for an empty event list', async () => {
		captureWaitlistFunnel(db, platform, FLOW, []);
		await flush();

		expect(await rows()).toEqual([]);
	});

	// The type makes this unreachable from our own code; the guard exists for the public command,
	// where the slug came off the wire.
	it('drops an unknown slug that reached it anyway', async () => {
		captureWaitlistFunnel(db, platform, FLOW, [
			'waitlist_purchased' as unknown as WaitlistFunnelEvent,
			'waitlist_viewed'
		]);
		await flush();

		expect(await rows()).toEqual([{ flowId: FLOW, event: 'waitlist_viewed' }]);
	});

	it('does nothing without a database client', () => {
		expect(() =>
			captureWaitlistFunnel(undefined, platform, FLOW, ['waitlist_viewed'])
		).not.toThrow();
		expect(inflight).toHaveLength(0);
	});

	// The whole posture in one test: analytics may fail, and the caller must never find out. A
	// rejected insert is logged and swallowed — no throw, and no unhandled rejection escaping into a
	// request that was otherwise fine.
	it('swallows a failing write', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const brokenDb = {
			insert: () => ({
				values: () => ({ onConflictDoNothing: () => Promise.reject(new Error('no database')) })
			})
		} as unknown as Db;

		expect(() =>
			captureWaitlistFunnel(brokenDb, platform, FLOW, ['waitlist_viewed'])
		).not.toThrow();
		await expect(flush()).resolves.toBeDefined();
		expect(error).toHaveBeenCalled();

		error.mockRestore();
	});

	// Under `vite dev` there is no ExecutionContext. The write must still be issued (the process
	// outlives the response there), and the missing ctx must not throw.
	it('still writes when the platform has no execution context', async () => {
		captureWaitlistFunnel(db, undefined, FLOW, ['waitlist_viewed']);
		// Nothing to drain — give the floating insert a turn to settle.
		await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
	});
});

describe('readWaitlistFunnelCounts', () => {
	it('zero-fills every stage nobody has reached', async () => {
		const counts = await readWaitlistFunnelCounts(db);

		expect(Object.keys(counts).sort()).toEqual([...WAITLIST_FUNNEL_EVENTS].sort());
		expect(Object.values(counts).every((n) => n === 0)).toBe(true);
	});

	it('counts distinct flows per stage', async () => {
		captureWaitlistFunnel(db, platform, FLOW, ['waitlist_viewed', 'waitlist_signup_completed']);
		captureWaitlistFunnel(db, platform, OTHER_FLOW, ['waitlist_viewed']);
		await flush();

		const counts = await readWaitlistFunnelCounts(db);
		expect(counts.waitlist_viewed).toBe(2);
		expect(counts.waitlist_signup_completed).toBe(1);
		expect(counts.qualification_started).toBe(0);
	});

	// A slug retired from the vocabulary should leave the readout with it — it has no label, and a
	// row from an older deploy shouldn't resurrect a stage the funnel no longer has.
	it('ignores stored rows whose slug is no longer known', async () => {
		await client.execute(
			"INSERT INTO waitlist_funnel_event (flow_id, event) VALUES ('" + FLOW + "', 'retired_event')"
		);

		const counts = await readWaitlistFunnelCounts(db);
		expect(Object.keys(counts)).not.toContain('retired_event');
		expect(Object.values(counts).every((n) => n === 0)).toBe(true);
	});
});

describe('signupConversionRate', () => {
	const counts = (over: Partial<WaitlistFunnelCounts> = {}): WaitlistFunnelCounts => ({
		...(Object.fromEntries(
			WAITLIST_FUNNEL_EVENTS.map((event) => [event, 0])
		) as WaitlistFunnelCounts),
		...over
	});

	it('is the signups over the views', () => {
		expect(
			signupConversionRate(counts({ waitlist_viewed: 200, waitlist_signup_completed: 50 }))
		).toBe(0.25);
	});

	// Null, not zero: with no denominator there is no rate, and "0%" would read as "nobody converts"
	// rather than "nothing measured yet".
	it('is null before anything has been viewed', () => {
		expect(signupConversionRate(counts({ waitlist_signup_completed: 3 }))).toBeNull();
	});

	// Deliberately unclamped. Above 100% means signups arrived without a matching view — a bot
	// posting straight to the endpoint, or a lost view write — and capping it would hide exactly the
	// anomaly worth seeing on an internal readout.
	it('does not hide a ratio above one', () => {
		expect(signupConversionRate(counts({ waitlist_viewed: 1, waitlist_signup_completed: 4 }))).toBe(
			4
		);
	});
});
