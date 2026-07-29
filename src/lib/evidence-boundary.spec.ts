import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import * as evidence from './evidence';
import { findCatalogTotalLeaks, findCatalogTotalLeaksInRenderedText } from './evidence-boundary';
import { THEOREMS_CHECKED } from './evidence';

// The published-surface IP boundary (DAR-43, docs/evidence.md): exact neural-architecture
// numbers and the theorem-catalog backlog must never appear in published copy. The evidence
// e2e asserts the RENDERED absences page by page; this spec guards the two SOURCES those pages
// draw from — the message catalog (every key, both locale files) and the $lib/evidence
// constants that supply the headline values and the parameterized figures — so a leak can't
// ship through a page or locale the e2e doesn't visit. A hit means the copy re-inlined
// something the boundary forbids: reword it, don't loosen the pattern.
//
// NOT covered here: source comments. They're published too (this repo is public — the DAR-43
// review found an `h=16` in a doc-comment), but a pattern scan over source false-positives
// immediately ("parameter" is legitimate prose in these very files), so comments stay
// code-review territory. Don't add a source scanner; do read comments when reviewing.
//
// The catalog total is NOT in this list, and that is the point: a literal here would write the
// secret into a public repo in order to guard it (the old entry did, and named the value in its
// own label). It lives in evidence-boundary.ts, derived from the figure we publish — see the
// describe block at the bottom.
const FORBIDDEN: { name: string; pattern: RegExp; keys?: RegExp }[] = [
	{ name: 'the controller parameter count', pattern: /\b40,?824\b/ },
	{ name: 'hidden-dimension wording', pattern: /hidden[- ]?(dim|unit)/i },
	{ name: 'hidden-dim shorthand (h=N)', pattern: /\bh=\d+/ },
	// The word "parameter" is legitimate elsewhere (query params, form copy), so the word-form
	// check is scoped to the keys that describe the engine: the evidence pages' own `evidence_*`
	// copy, the `domain_*` labels the domains card pulls in through $lib/evidence's DOMAINS, and
	// the homepage's `section_domains_*` block — the domains section is prose ABOUT the engine's
	// specialization, the likeliest place for an architecture number to be written in by hand
	// (DAR-46 added section_domains_scope there, outside the original two prefixes).
	{
		name: 'parameter-count wording on evidence copy',
		pattern: /\bparameters?\b/i,
		keys: /^(evidence|domain|section_domains)_/
	}
];

describe.each([
	['en', en as Record<string, unknown>],
	['es', es as Record<string, unknown>]
])('messages/%s.json stays inside the evidence IP boundary', (_locale, catalog) => {
	it.each(FORBIDDEN)('contains no $name', ({ pattern, keys }) => {
		const hits = Object.entries(catalog)
			.filter(([key, value]) => typeof value === 'string' && (!keys || keys.test(key)))
			.filter(([, value]) => pattern.test(value as string))
			.map(([key]) => key);
		expect(hits).toEqual([]);
	});
});

// The figures themselves: card values and message parameters come from these constants, so a
// forbidden number re-inlined here would render while the catalog scan above stayed green.
// Message-function exports (DOMAINS' label refs) stringify to source text — scan the numeric
// patterns only, which is where an architecture figure would land.
describe('$lib/evidence constants stay inside the IP boundary', () => {
	it.each(FORBIDDEN.filter(({ keys }) => !keys))('contain no $name', ({ pattern }) => {
		const hits = Object.entries(evidence)
			.filter(([, value]) => typeof value === 'string' || typeof value === 'number')
			.filter(([, value]) => pattern.test(String(value)))
			.map(([name]) => name);
		expect(hits).toEqual([]);
	});
});

// The catalog total (DAR-152). Its own rules, because it is the one forbidden figure that cannot
// be written down here — the value guard is derived from THEOREMS_CHECKED rather than from the
// secret, so this file names no number and a re-measure carries the boundary with it.
describe('the theorem-catalog total stays off the published surface', () => {
	describe.each([
		['en', en as Record<string, unknown>],
		['es', es as Record<string, unknown>]
	])('messages/%s.json', (_locale, catalog) => {
		it('publishes no catalog total, corpus percentage or backlog wording', () => {
			const hits = Object.entries(catalog).flatMap(([key, value]) =>
				typeof value === 'string'
					? findCatalogTotalLeaks(value, THEOREMS_CHECKED).map((hit) => `${key}: ${hit}`)
					: []
			);
			expect(hits).toEqual([]);
		});
	});

	it('finds no leak in the $lib/evidence string constants', () => {
		const hits = Object.entries(evidence).flatMap(([name, value]) =>
			typeof value === 'string'
				? findCatalogTotalLeaks(value, THEOREMS_CHECKED).map((hit) => `${name}: ${hit}`)
				: []
		);
		expect(hits).toEqual([]);
	});

	// A numeric export carries no prose, so the proximity half can never fire on one — and a bare
	// `export const THEOREM_CATALOG = 346` is exactly how the total would arrive in this module.
	// Hence the flat ceiling: the count we publish is the largest number this module may hold.
	it('exports no number larger than the count we publish', () => {
		const hits = Object.entries(evidence)
			.filter(([, value]) => typeof value === 'number' && value > THEOREMS_CHECKED)
			.map(([name, value]) => `${name} = ${value}`);
		expect(hits).toEqual([]);
	});
});

// The detector itself. The scans above are all "nothing matched", so on their own they pass just
// as happily against a predicate that answers nothing at all — these are what make them mean
// something. Every negative case below is real copy that a cruder rule reported (measured, not
// imagined): drop the band and "Lean 4" reports itself, drop the proximity test and the benchmark
// iteration counts report themselves, and neither half survives without the calendar-year
// exclusion, since both dated lines put a year beside the words "corpus" and "theorems".
describe('findCatalogTotalLeaks', () => {
	const leaks = (text: string) => findCatalogTotalLeaks(text, 219);

	it.each([
		['a bare total beside theorem wording', 'The catalog holds 338 theorems in total.'],
		['a re-measured total', 'Our framework now catalogues 346 theorems.'],
		['a total stated as a proportion', '260 theorems, 75.4% of the catalogued corpus.'],
		['a total with a thousands separator', 'The corpus contains 1,024 theorems.'],
		['the remainder, as a backlog', 'The remaining theorem backlog is tracked internally.'],
		['the remainder, spelled out', 'The rest of the corpus is unmechanized.'],
		['the remainder, as prose', 'Some theorems in the corpus remain unproven for now.']
	])('catches %s', (_case, text) => {
		expect(leaks(text)).not.toEqual([]);
	});

	it.each([
		['prover versions', 'machine-checked in Lean 4 and Isabelle/HOL with zero local axioms'],
		['a checksum algorithm', 'Releases ship with a SHA-256 checksum manifest of the corpus.'],
		['a benchmark iteration count', 'Arithmetic mean over 10,000 calls after 1,000 warmup.'],
		['a dated line', 'Measured December 2025 · GIDE benchmark corpus'],
		['a non-numeric percentage', 'Theorem coverage grew by a few percent.'],
		['the published count itself', '219 theorems are machine-checked; 31 are complete.'],
		['a large number away from theorem wording', 'Phone: 555 1234 · budget over 500,000.']
	])('stays silent on %s', (_case, text) => {
		expect(leaks(text)).toEqual([]);
	});

	it('reports the number it found, so a failure names the leak', () => {
		expect(leaks('The catalog holds 338 theorems.')[0]).toContain('338');
	});

	// A leak in the first CONTEXT_WINDOW characters of a long string. String.slice reads a
	// negative start as an offset from the END, so an unguarded `at - CONTEXT_WINDOW` tests the
	// TAIL of the text instead of the neighbourhood of the hit — and a leak that opens a long
	// paragraph is missed. Every other case here is shorter than the window, where a negative
	// start clamps to 0 and the fault is invisible: reinstating it passed all 31 tests.
	it('catches a leak at the start of a long line', () => {
		const filler = ' Runs are published nightly with full environment detail for each host.';
		expect(leaks(`The catalog holds 338 theorems.${filler}`)).not.toEqual([]);
	});

	// The band tracks the published figure rather than a hardcoded vintage — that is the whole
	// reason this file holds no secret. A re-measure must therefore MOVE it, not just widen it:
	// once 338 is below the published count it is no longer a total, and the next one is caught.
	it('moves with the published count instead of pinning a vintage', () => {
		const text = 'The catalog holds 338 theorems.';
		expect(findCatalogTotalLeaks(text, 219)).not.toEqual([]);
		expect(findCatalogTotalLeaks(text, 400)).toEqual([]);
		expect(findCatalogTotalLeaks('The catalog holds 512 theorems.', 400)).not.toEqual([]);
	});
});

// Rendered pages, where a "line" is an element rather than a sentence. Both fixtures below are
// the REAL rendered text of the pages they name, captured from the running preview — reasoning
// about what innerText would produce is exactly what put the card-shaped hole in the first cut.
describe('findCatalogTotalLeaksInRenderedText', () => {
	const rendered = (lines: string[]) => findCatalogTotalLeaksInRenderedText(lines.join('\n'), 219);

	// The shape the claim cards use: a bare value in large type, its label in the next element.
	// The line-at-a-time scan this replaced could not see it — measured, `346` above "Theorems in
	// the catalog" passed all six evidence e2e tests, and that is how a total would be published.
	it('catches a total split across a value and its label', () => {
		expect(rendered(['346', 'Theorems in the catalog'])).not.toEqual([]);
	});

	// The homepage readout row, real values in rendered order with the LABEL lines removed — which
	// puts `13,000×` two lines nearer the theorems readout than the page does, so passing here is
	// strictly harder than passing on the page. This is the collision that rules out a whole-page
	// scan, and widening the window past a pair walks back into it.
	it('stays silent on the homepage readout row', () => {
		expect(
			rendered(['0.767 µs', '13,000×', '31', 'THEOREMS COMPLETE OF 219 MACHINE-CHECKED', '5'])
		).toEqual([]);
	});

	// The /evidence theorems card, whose value IS a theorem count sitting right above its label —
	// the same shape as the leak above, one figure below the boundary.
	it('stays silent on the evidence theorems card', () => {
		expect(
			rendered([
				'219',
				'Theorems machine-checked',
				'As of GIDE release v2026.07.1 · July 2026',
				'219 theorems in the GIDE framework are machine-checked. 31 of those are complete.'
			])
		).toEqual([]);
	});

	it('still catches a leak contained in a single line', () => {
		expect(
			rendered(['Prover versions', 'The catalog holds 338 theorems.', '0.767 µs'])
		).not.toEqual([]);
	});
});
