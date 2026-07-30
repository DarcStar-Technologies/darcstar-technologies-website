import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import {
	SAFETY_LANGUAGE_RULES as FORBIDDEN,
	findSafetyLanguageViolations
} from './safety-language';

// The published safety vocabulary (DAR-46, docs/evidence.md). The 2026-07-23 review found the
// homepage and /about asserting safety as a settled conclusion — "proven safe", "Not tested —
// proven", "when GIDE says a system is safe, there is a proof" — while /evidence defined `proven`
// narrowly and published the assumptions those claims rest on. The copy now says "formally
// verified against stated system and environment assumptions" instead, and this spec keeps it
// that way: the drift that made DAR-46 necessary happened once, silently, and nothing failed.
//
// Sibling of evidence-boundary.spec.ts and the same contract — it guards the SOURCE (both locale
// catalogs, so a leak can't ship through a page or locale the e2e never visits) and a hit means
// REWORD THE COPY, never loosen the pattern. The two specs are deliberately separate: that one is
// an IP boundary (what we must not disclose), this one is a truth boundary (what we must not
// overstate). NOT covered here, same as there: source comments — a pattern scan over source
// false-positives immediately, so comments stay code-review territory.
//
// The RULES moved to $lib/safety-language.ts in DAR-171, so `pnpm check:cms` can apply these exact
// patterns to CMS prose — a third published surface no spec can see, because CI has no Sanity read
// token. They are imported here rather than restated: a second copy is the rot DAR-99 measured.

describe.each([
	['en', en as Record<string, unknown>],
	['es', es as Record<string, unknown>]
])('messages/%s.json states safety claims with their assumptions', (_locale, catalog) => {
	it.each(FORBIDDEN)('contains no $name', ({ pattern, allowKeys }) => {
		const hits = Object.entries(catalog)
			.filter(([key, value]) => typeof value === 'string' && !allowKeys?.includes(key))
			.filter(([, value]) => pattern.test(value as string))
			.map(([key]) => key);
		expect(hits).toEqual([]);
	});
});

// The finder `pnpm check:cms` runs over CMS prose. It needs POSITIVE cases of its own: every
// assertion above is "nothing matched", and that shape passes just as happily against a detector
// that answers nothing (DAR-152). These are the cases that prove it answers.
describe('findSafetyLanguageViolations', () => {
	it.each([
		['proven safe', 'Our controller is proven safe in every configuration.'],
		['provably safe', 'A provably safe autonomy stack.'],
		['guaranteed safe', 'Every trajectory is guaranteed safe.'],
		['proven microsecond', 'We ship proven microsecond safety envelopes.'],
		['proven latency', 'A proven latency bound of under a microsecond.']
	])('flags %s', (_label, text) => {
		expect(findSafetyLanguageViolations(text)).not.toEqual([]);
	});

	it.each([
		[
			'the qualified formulation',
			'Formally verified against stated system and environment assumptions.'
		],
		['provability as a claim about proofs', 'Autonomous control you can prove is safe.'],
		['a measured latency figure', 'The kernel evaluates in 0.767 µs, measured over 1,000 runs.'],
		['safety without a collapsed conclusion', 'The safety cluster is machine-checked in Lean 4.']
	])('leaves %s alone', (_label, text) => {
		expect(findSafetyLanguageViolations(text)).toEqual([]);
	});

	it('quotes the offending sentence back, so a hit is actionable', () => {
		const [hit] = findSafetyLanguageViolations('The pilot concluded the system is proven safe.');
		expect(hit).toContain('proven safe');
		expect(hit).toContain('The pilot concluded');
	});

	// The allowlist is a CATALOG concept — a CMS document has no message key, so the excused
	// phrasing is still reported there and a human decides. Asserted so the asymmetry is deliberate
	// rather than discovered later as a surprise.
	it('applies every rule regardless of the catalog allowlist', () => {
		const excused = en as Record<string, string>;
		expect(findSafetyLanguageViolations(excused.evidence_safety_not_covered)).not.toEqual([]);
	});
});

// An allowlist that stops matching is a silent hole: the copy it excused could be reworded, the
// entry left behind, and the next violation of that key would sail through. Assert every excused
// key still says the thing it was excused for.
//
// One flat `it` rather than an it.each over the allowlisted patterns: vitest fails a suite that
// registers zero tests ("No test found in suite"), so an it.each would turn "someone removed the
// last allowlist entry" — a perfectly fine state — into a confusing suite-level error.
describe('the safety-language allowlist stays load-bearing', () => {
	it('every allowlisted key still quotes the phrase it is excused for', () => {
		const stale = FORBIDDEN.flatMap(({ name, pattern, allowKeys }) =>
			(allowKeys ?? [])
				.filter((key) => {
					const value = (en as Record<string, unknown>)[key];
					return typeof value !== 'string' || !pattern.test(value);
				})
				.map((key) => `${key} no longer quotes ${name}`)
		);
		expect(stale).toEqual([]);
	});
});
