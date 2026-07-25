import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import * as evidence from './evidence';

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
const FORBIDDEN: { name: string; pattern: RegExp; keys?: RegExp }[] = [
	{ name: 'the theorem-catalog total (338)', pattern: /\b338\b/ },
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
