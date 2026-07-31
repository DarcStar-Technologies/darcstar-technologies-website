import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import {
	CFC_KERNEL_LATENCY,
	CONTROLLER_LATENCY_P50,
	CONTROLLER_LATENCY_P99,
	CONTROLLER_MARGIN_P50,
	CONTROLLER_MARGIN_P99,
	REALTIME_MULTIPLE,
	realtimeMargin
} from './evidence';

// Every real-time margin the site publishes is a QUOTIENT of two things printed beside it — the
// 10 ms control budget and a measured latency — which makes it the one figure on the evidence
// surface a reader can check without leaving the page. DAR-209 was filed because a reviewer did:
// one margin was published over a p50/p99 PAIR with no percentile attached, so recomputing it gave
// 192× or 106× depending on which latency you picked, and under a real-time budget the tail is the
// one you pick.
//
// This file pins the arithmetic. `evidence-disclosure.spec.ts` pins the other half — that each
// published margin says which latency it came from — because a margin that recomputes correctly
// from a figure the reader cannot identify is still the defect.

// Restated here rather than imported, and that IS the test: taking the numerator from the module
// under test would be checking the arithmetic against itself. This is the reader's own sum written
// down, so if $lib/evidence ever retargets the control loop this fails and a human decides which
// of the two is right. (It cannot be imported anyway — evidence-boundary.spec.ts holds that module
// to exporting no number above the theorem count we publish.)
const CONTROL_BUDGET_US = 10_000;

/** The number out of a published figure: `≈52 µs` → 52, `13,000×` → 13000. */
const figure = (published: string) => Number(published.replace(/[^\d.]/g, ''));

describe('the published real-time margins (DAR-209)', () => {
	// The reader's recomputation, as an inequality rather than a restated expectation — asserting
	// `toBe('190×')` here would only prove the constant equals itself. Two bounds, and each catches a
	// different failure: `<=` is the direction that matters, since a margin is the one figure on
	// these pages we benefit from overstating; `> ratio × 0.9` is what stops a margin drifting free
	// of its latency altogether, because two-significant-figure rounding can lose at most one step,
	// and one step is under a tenth of the value.
	it.each([
		['the reference kernel', CFC_KERNEL_LATENCY, REALTIME_MULTIPLE],
		['the deployed controller at p50', CONTROLLER_LATENCY_P50, CONTROLLER_MARGIN_P50],
		['the deployed controller at p99', CONTROLLER_LATENCY_P99, CONTROLLER_MARGIN_P99]
	])('recomputes from the latency published beside it: %s', (_case, latency, margin) => {
		const ratio = CONTROL_BUDGET_US / figure(latency);
		expect(
			figure(margin),
			'the published margin is larger than the measurement'
		).toBeLessThanOrEqual(ratio);
		expect(figure(margin), 'the published margin is not that quotient at all').toBeGreaterThan(
			ratio * 0.9
		);
	});

	it('rounds a margin down, never up', () => {
		// 10 ms ÷ 52 µs is 192.3 and 10 ms ÷ 50.1 µs is 199.6. To one significant figure both are
		// 200× — a margin larger than anything measured, in our own favour, which is the one
		// direction a claim like this must never round.
		expect(realtimeMargin(52)).toBe('190×');
		expect(realtimeMargin(50.1)).toBe('190×');
	});

	it('formats a four-digit margin the way the readouts do', () => {
		// 10 ms ÷ 1 µs. Deliberately not the kernel latency, so the separator has a case of its own
		// rather than riding on REALTIME_MULTIPLE's.
		expect(realtimeMargin(1)).toBe('10,000×');
	});

	// Why the precision is coarse, stated as the property it buys rather than as a preference. The
	// ticket proposed publishing "≈106×" for the tail, which is 10 ms ÷ 94 µs — and 94 µs turned out
	// to be a figure from the capture's own headline COMMENT that its data table (98.654 µs)
	// contradicts. At three significant figures that correction moves the published margin from 106×
	// to 101×, and every such move reads as a claim being walked back. At two, rounded down, it does
	// not move at all: the same number was already the honest one.
	it('is unmoved by the tail correction that prompted the ticket', () => {
		expect(realtimeMargin(94)).toBe(CONTROLLER_MARGIN_P99);
		expect(realtimeMargin(99)).toBe(CONTROLLER_MARGIN_P99);
	});

	// Not a claim that any tail gives the same answer — the fast end of the measured spread does
	// not, and that is exactly why the site publishes the SLOWEST figure on record. The margin is
	// then a floor over everything measured rather than a midpoint half the runs fall short of.
	it('publishes the floor of the measured spread, not its midpoint', () => {
		expect(figure(realtimeMargin(77))).toBeGreaterThan(figure(CONTROLLER_MARGIN_P99));
	});

	// That policy — publish the slowest — is the one thing here a test can hold against something
	// other than itself, and it is worth holding because breaking it is the defect this ticket
	// corrects. The site published ≈94 µs at p99 while the capture it cites recorded 98.654: a tail
	// quietly lower than the measurement, which flatters every margin derived from it. Nothing could
	// have caught that, and the e2e still cannot — it reads the same constant it asserts, so moving
	// the constant moves the expectation with it.
	//
	// What it can be held against is the spread the page itself states. Deliberately coupled to that
	// copy: the two have to move together anyway (docs/evidence.md's "a figure and its dated line
	// change together"), so a reword that leaves the published figure behind should fail here rather
	// than ship. On a hit, check the figure against GIDE's capture, then fix whichever is stale.
	it.each([
		['p50', CONTROLLER_LATENCY_P50],
		['p99', CONTROLLER_LATENCY_P99]
	])(
		'publishes the top of the run-to-run spread the page states at %s',
		(percentile, published) => {
			const spread = new RegExp(`(\\d+) and (\\d+) µs at ${percentile}`).exec(
				en.evidence_bench_controller_environment
			);
			expect(spread, `the environment copy no longer states a ${percentile} spread`).not.toBeNull();
			const [, fastest, slowest] = spread!.map(Number);
			expect(figure(published), 'the published figure is faster than a run on record').toBe(
				slowest
			);
			expect(slowest, 'the stated spread runs backwards').toBeGreaterThan(fastest);
		}
	);
});

// docs/evidence.md's "never re-inline a figure", scoped to the figure class this ticket found
// duplicated. Every multiplier on the site is DERIVED — a quotient of two other published figures —
// so each one belongs to the module that owns the division, and a hand-typed `190×` is a copy the
// constants can no longer move. Measured latencies are deliberately NOT covered by this: the
// per-run provenance figures (`0.75 µs mean`, `0.81 and 0.91 µs`) live only in the
// `evidence_bench_*` messages by design, so a µs rule would fire on copy that is doing its job.
//
// On a hit, make it a constant — do not loosen this.
describe.each([
	['en', en as Record<string, unknown>],
	['es', es as Record<string, unknown>]
])('messages/%s.json states no multiplier of its own', (_locale, catalog) => {
	it('has every × figure arrive as a parameter', () => {
		const hits = Object.entries(catalog)
			.filter(([, value]) => typeof value === 'string' && /\d\s*×/.test(value))
			.map(([key]) => key);
		expect(hits).toEqual([]);
	});
});
