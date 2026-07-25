import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

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
// Scoped to conclusions, not vocabulary. "Proven", "provable", "guarantee" and "safe" are all
// legitimate on their own — the site does prove theorems, and the H1 "Autonomous control you can
// prove is safe." claims provability, which is true. What is banned is the collapsed form that
// asserts a system IS safe with no assumptions attached, plus the one phrasing docs/evidence.md
// forbids outright (a proven latency bound — GIDE's corpus proves none).
const FORBIDDEN: { name: string; pattern: RegExp; allowKeys?: string[] }[] = [
	{ name: 'the phrase "proven safe"', pattern: /\bproven[ -]safe\b/i },
	{ name: 'the phrase "provably safe"', pattern: /\bprovably[ -]safe\b/i },
	{ name: 'the phrase "guaranteed safe"', pattern: /\bguaranteed[ -]safe\b/i },
	{
		// docs/evidence.md: "Never claim a proven latency bound." No microsecond or latency bound
		// is proven anywhere in the corpus; latency is measured and the 13,000× is derived.
		name: 'a proven sub-second bound ("proven microsecond safety")',
		pattern: /\bproven\s+(micro|milli|nano)?second/i,
		// The safety card's own boundary statement quotes the banned phrase in order to disavow
		// it ("...any 'proven microsecond safety' phrasing would be false, and we do not use
		// it."). That sentence is the point of the rule, not a violation of it — it is the ONLY
		// key allowed to contain the phrase, and it must keep quoting it verbatim to stay legible.
		allowKeys: ['evidence_safety_not_covered']
	},
	{ name: 'a proven latency claim', pattern: /\bproven\s+latency\b/i }
];

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
