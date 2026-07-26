import { describe, expect, it } from 'vitest';
import {
	CLIENT_FIREABLE_FUNNEL_EVENTS,
	WAITLIST_FUNNEL_EVENTS,
	echoFlowId,
	isClientFireableFunnelEvent,
	isWaitlistFlowId,
	isWaitlistFunnelEvent
} from './waitlist-funnel';

// The funnel's write guards (DAR-66). Both validators stand between a public request and a row, so
// they're pinned here rather than left to the type system: `isClientFireableFunnelEvent` is the only
// thing bounding what a script may add to the numbers, and `isWaitlistFlowId` is the only thing
// bounding what can land in the column.

describe('the event vocabulary', () => {
	it('lists every event exactly once', () => {
		expect(new Set(WAITLIST_FUNNEL_EVENTS).size).toBe(WAITLIST_FUNNEL_EVENTS.length);
	});

	// The list order is the funnel order, and the admin readout renders it as-is — so a visitor can
	// only reach a stage after the ones above it. Pin the two ends and the pair the primary metric
	// divides, which are the only positions with meaning beyond presentation.
	it('opens with the view and closes with the conversation request', () => {
		expect(WAITLIST_FUNNEL_EVENTS[0]).toBe('waitlist_viewed');
		expect(WAITLIST_FUNNEL_EVENTS[1]).toBe('waitlist_signup_completed');
		expect(WAITLIST_FUNNEL_EVENTS.at(-1)).toBe('evaluation_conversation_requested');
	});
});

describe('isWaitlistFunnelEvent', () => {
	it('accepts every slug in the vocabulary', () => {
		for (const event of WAITLIST_FUNNEL_EVENTS) expect(isWaitlistFunnelEvent(event)).toBe(true);
	});

	it.each([
		['an unknown slug', 'waitlist_purchased'],
		['a near-miss', 'waitlist_view'],
		['the wrong case', 'WAITLIST_VIEWED'],
		['padding', ' waitlist_viewed '],
		['an empty string', ''],
		['a number', 1],
		['null', null],
		['undefined', undefined],
		['an object', { event: 'waitlist_viewed' }]
	])('rejects %s', (_label, value) => {
		expect(isWaitlistFunnelEvent(value)).toBe(false);
	});
});

describe('isClientFireableFunnelEvent', () => {
	// The guarantee that matters: a browser may ask for the pilot-CTA event and NOTHING else. Every
	// other stage is decided by a request the server already handles, so accepting one here would let
	// anyone inflate the exact numbers the readout reports.
	it('accepts only the events a browser is the sole witness to', () => {
		expect([...CLIENT_FIREABLE_FUNNEL_EVENTS]).toEqual(['evaluation_conversation_requested']);
	});

	it('rejects every server-decided event', () => {
		const serverOnly = WAITLIST_FUNNEL_EVENTS.filter(
			(event) => !(CLIENT_FIREABLE_FUNNEL_EVENTS as readonly string[]).includes(event)
		);
		expect(serverOnly.length).toBeGreaterThan(0);
		for (const event of serverOnly) expect(isClientFireableFunnelEvent(event)).toBe(false);
	});

	// A client-fireable slug that isn't a real event would be accepted at the endpoint and then
	// silently dropped at the write — the sort of drift that reads as "analytics is broken".
	it('is a strict subset of the vocabulary', () => {
		for (const event of CLIENT_FIREABLE_FUNNEL_EVENTS) {
			expect(isWaitlistFunnelEvent(event)).toBe(true);
		}
		expect(CLIENT_FIREABLE_FUNNEL_EVENTS.length).toBeLessThan(WAITLIST_FUNNEL_EVENTS.length);
	});
});

describe('isWaitlistFlowId', () => {
	it('accepts what mints one', () => {
		expect(isWaitlistFlowId(crypto.randomUUID())).toBe(true);
	});

	it('accepts either case', () => {
		expect(isWaitlistFlowId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
		expect(isWaitlistFlowId('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
	});

	// Not version-pinned on purpose (the value carries no meaning beyond "one visitor's pass"), so a
	// v7-shaped id keeps working.
	it('does not care which UUID version it is', () => {
		expect(isWaitlistFlowId('0192f0d5-9a7b-7c3d-8e4f-1a2b3c4d5e6f')).toBe(true);
	});

	it.each([
		['an empty string', ''],
		['a short id', 'abc'],
		['a UUID without dashes', '3f2504e04f8941d39a0c0305e82c3301'],
		['a trailing character', '3f2504e0-4f89-41d3-9a0c-0305e82c3301x'],
		['a leading space', ' 3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
		['a non-hex character', '3f2504e0-4f89-41d3-9a0c-0305e82c330g'],
		['an email', 'ada@example.com'],
		['SQL', "'; drop table waitlist_funnel_event; --"],
		['a number', 42],
		['null', null],
		['undefined', undefined]
	])('rejects %s', (_label, value) => {
		expect(isWaitlistFlowId(value)).toBe(false);
	});
});

describe('echoFlowId', () => {
	it('reflects a well-formed id verbatim', () => {
		const id = crypto.randomUUID();
		expect(echoFlowId(id)).toBe(id);
	});

	// '' rather than the junk: the page treats an empty echo as "no echo" and falls back to the id its
	// own load minted, so a malformed submission costs that visitor a split funnel and nothing else.
	it.each([['junk'], [''], ['3f2504e0-4f89-41d3-9a0c-0305e82c3301 ']])(
		'drops %j outright',
		(value) => {
			expect(echoFlowId(value)).toBe('');
		}
	);

	it('drops a non-string', () => {
		expect(echoFlowId(undefined)).toBe('');
		expect(echoFlowId(123)).toBe('');
	});
});
