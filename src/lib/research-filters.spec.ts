import { describe, expect, it, vi } from 'vitest';
import {
	AUTHOR_QUERY_MIN_LENGTH,
	authorOptionLabel,
	authorSearchTerm,
	buildFilterQuery,
	contributionOptions,
	FILTER_PARAM,
	hasActiveFilters,
	partitionByOrigin,
	parseResearchFilters,
	researchTopicHref,
	topicOptions,
	type AuthorOption,
	type PaperRow,
	type TopicEntry
} from './research-filters';
import { PAGE_PARAM } from './pagination';

// researchTopicHref localizes via the Paraglide runtime, whose getLocale() needs a request /
// browser context this bare unit environment lacks. Identity-mock it: these tests pin the
// PATH + PARAM shape (the drift rail); locale prefixing is Paraglide's, covered by e2e.
vi.mock('$lib/paraglide/runtime', () => ({ localizeHref: (href: string) => href }));

// Minimal PaperRow stand-ins — only the fields the surviving derivations touch; the cast keeps the
// fixtures honest against renames without dragging in every projected field. Note `topics` carries
// no `description`: DAR-94 dropped it from the LIST projection (the topic facet supplies it once
// instead of once per tag occurrence), and the fixture shape says so.
const paper = (over: {
	_id: string;
	title: string;
	darcstarAuthored?: boolean | null;
	publishedDate?: string | null;
	topics?: { slug: string; title: string }[] | null;
	authors?: { slug: string; name: string }[] | null;
}): PaperRow =>
	({
		darcstarAuthored: null,
		publishedDate: null,
		topics: null,
		authors: null,
		...over
	}) as unknown as PaperRow;

const gide = paper({
	_id: 'p1',
	title: 'GIDE: Guaranteed Intelligent Dynamics',
	darcstarAuthored: true
});
const attention = paper({
	_id: 'p2',
	title: 'Attention Is All You Need',
	darcstarAuthored: false
});
// Unset origin — must count as external (DAR-52 fail-safe polarity).
const flash = paper({ _id: 'p3', title: 'FlashAttention' });
const all = [gide, attention, flash];

describe('parseResearchFilters', () => {
	it('defaults everything with no params', () => {
		expect(parseResearchFilters(new URLSearchParams())).toEqual({
			topic: null,
			contribution: null,
			author: null,
			origin: null,
			sort: 'date'
		});
	});

	it('treats empty-string params (no-JS GET submit) as unset', () => {
		const f = parseResearchFilters(
			new URLSearchParams('topic=&contribution=&author=&origin=&sort=')
		);
		expect(f).toEqual({
			topic: null,
			contribution: null,
			author: null,
			origin: null,
			sort: 'date'
		});
		expect(hasActiveFilters(f)).toBe(false);
	});

	it('rejects unknown origin/sort values instead of trusting the URL', () => {
		const f = parseResearchFilters(new URLSearchParams('origin=bogus&sort=venue'));
		expect(f.origin).toBeNull();
		expect(f.sort).toBe('date');
	});

	// `contribution` is a closed enum (DAR-162), so junk is discarded here rather than round-tripped
	// to GROQ — unlike `topic`, whose vocabulary is authored content this file cannot enumerate.
	it.each(['banana', 'CONCEPTUAL', 'conceptual-framework', 'conceptual '])(
		'rejects "%s" as a contribution kind',
		(value) => {
			const params = new URLSearchParams();
			params.set('contribution', value);
			expect(parseResearchFilters(params).contribution).toBeNull();
		}
	);

	it.each(['conceptual', 'formal', 'empirical', 'engineering'] as const)(
		'accepts %s and reports it active',
		(kind) => {
			const f = parseResearchFilters(new URLSearchParams(`contribution=${kind}`));
			expect(f.contribution).toBe(kind);
			expect(hasActiveFilters(f)).toBe(true);
		}
	);

	it('accepts the date-asc sort and reports it active', () => {
		const f = parseResearchFilters(new URLSearchParams('sort=date-asc'));
		expect(f.sort).toBe('date-asc');
		expect(hasActiveFilters(f)).toBe(true);
	});

	it('accepts the full valid set and reports it active', () => {
		const f = parseResearchFilters(
			new URLSearchParams(
				'topic=transformers&contribution=formal&author=a-vaswani&origin=external&sort=title'
			)
		);
		expect(f).toEqual({
			topic: 'transformers',
			contribution: 'formal',
			author: 'a-vaswani',
			origin: 'external',
			sort: 'title'
		});
		expect(hasActiveFilters(f)).toBe(true);
	});

	// The author param accepts a typed NAME as well as a slug (the control is a text input — the
	// author vocabulary is too large to ship as options). Both reach GROQ verbatim, which resolves
	// either; the parser must not try to tell them apart.
	it('passes a typed author name through unchanged', () => {
		expect(parseResearchFilters(new URLSearchParams('author=Tri+Dao')).author).toBe('Tri Dao');
	});

	// ?page= is pagination's, not a filter's — `hasActiveFilters` drives the "Clear filters" link,
	// and paging to page 2 must not make the page claim filters are in force.
	it('ignores the page param entirely', () => {
		const f = parseResearchFilters(new URLSearchParams('page=3'));
		expect(f).toEqual({
			topic: null,
			contribution: null,
			author: null,
			origin: null,
			sort: 'date'
		});
		expect(hasActiveFilters(f)).toBe(false);
	});
});

describe('researchTopicHref', () => {
	it('builds the filtered-list URL from the shared param name', () => {
		expect(researchTopicHref('efficient-attention')).toBe('/research?topic=efficient-attention');
	});

	it('URL-encodes the slug', () => {
		expect(researchTopicHref('a&b c')).toBe('/research?topic=a%26b%20c');
	});
});

describe('buildFilterQuery', () => {
	const values = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

	it('carries only set values and drops empties', () => {
		expect(
			buildFilterQuery(
				values({ topic: 'transformers', contribution: '', author: '', origin: '', sort: '' })
			)
		).toBe('topic=transformers');
	});

	// The builder iterates FILTER_PARAM, so a new facet is carried by adding the param and nothing
	// else. Pinned because that is invisible in the source — nothing here mentions `contribution`.
	it('carries the contribution filter', () => {
		expect(buildFilterQuery(values({ contribution: 'conceptual' }))).toBe(
			'contribution=conceptual'
		);
	});

	it('returns an empty string when nothing is set', () => {
		expect(buildFilterQuery(values({}))).toBe('');
	});

	it('ignores unknown keys', () => {
		expect(buildFilterQuery(values({ evil: 'x', sort: 'title' }))).toBe('sort=title');
	});

	// THE page-reset rule (DAR-94). Narrowing a filter must return the visitor to page 1 — page 7 of
	// a filter that now has two results is an empty screen with no explanation. It is enforced by
	// omission rather than by code: `page` is not in FILTER_PARAM, so this builder cannot emit it
	// even when handed one. That makes the guarantee invisible in the source, which is exactly why
	// it needs a test rather than a comment.
	it('never carries a page number forward, even if the form supplies one', () => {
		expect(buildFilterQuery(values({ page: '7', topic: 'x' }))).toBe('topic=x');
	});

	it('keeps page out of the filter param contract', () => {
		expect(Object.values(FILTER_PARAM)).not.toContain(PAGE_PARAM);
	});
});

describe('topicOptions', () => {
	const topics: TopicEntry[] = [
		{ slug: 'safety', title: 'Provable Safety', description: 'Verified control.' },
		{ slug: 'transformers', title: 'Transformer Architecture', description: null }
	];

	it('projects facet entries down to the select shape, dropping the description', () => {
		expect(topicOptions(topics)).toEqual([
			{ value: 'safety', label: 'Provable Safety' },
			{ value: 'transformers', label: 'Transformer Architecture' }
		]);
	});

	it('handles an empty vocabulary', () => {
		expect(topicOptions([])).toEqual([]);
	});
});

describe('contributionOptions', () => {
	const label = (kind: string) => `label:${kind}`;

	// The reason this isn't `inUse.map(...)`. The facet is `array::unique` over a projection, so its
	// order is whatever the Content Lake returned rows in — not a contract, and stable enough in
	// practice to hide the bug. CONTRIBUTION_KINDS is the Studio's own field order and reads as a
	// maturity ladder, so it wins over whatever arrives.
	it('orders by the canonical vocabulary, not by the facet', () => {
		expect(
			contributionOptions(['engineering', 'conceptual', 'empirical', 'formal'], label)
		).toEqual([
			{ value: 'conceptual', label: 'label:conceptual' },
			{ value: 'formal', label: 'label:formal' },
			{ value: 'empirical', label: 'label:empirical' },
			{ value: 'engineering', label: 'label:engineering' }
		]);
	});

	// The "only offer values that match at least one paper" guarantee the topic and author facets
	// already give. Real work, not defensiveness: three of the four kinds are declared by no paper
	// today, so offering all four would ship a control where 3 of 4 picks return nothing.
	it('offers only the kinds in use', () => {
		expect(contributionOptions(['conceptual'], label)).toEqual([
			{ value: 'conceptual', label: 'label:conceptual' }
		]);
	});

	it('offers nothing when no paper declares a kind', () => {
		expect(contributionOptions([], label)).toEqual([]);
	});

	// A kind the Studio grew but this repo has not — the facet would carry it, and an option with no
	// label is worse than no option. Membership is read from CONTRIBUTION_KINDS, so it drops out.
	it('ignores a value outside the vocabulary', () => {
		expect(contributionOptions(['speculative', 'formal'], label)).toEqual([
			{ value: 'formal', label: 'label:formal' }
		]);
	});

	it('never duplicates a kind the facet repeats', () => {
		expect(contributionOptions(['formal', 'formal'], label)).toHaveLength(1);
	});
});

describe('partitionByOrigin', () => {
	it('splits by the fail-safe polarity and preserves order within each side', () => {
		// gide is ours; attention is explicitly false; flash leaves the flag UNSET — DAR-52 says
		// that stays third-party. The GROQ half of this rule (`darcstarAuthored != true`) is pinned
		// separately in sanity/queries.spec.ts; the polarity now lives in two languages.
		const { darcstar, external } = partitionByOrigin(all);
		expect(darcstar.map((p) => p._id)).toEqual(['p1']);
		expect(external.map((p) => p._id)).toEqual(['p2', 'p3']);
	});

	it('returns two empty sides for an empty index', () => {
		expect(partitionByOrigin([])).toEqual({ darcstar: [], external: [] });
	});
});

describe('authorSearchTerm', () => {
	it('accepts a term at the minimum length', () => {
		expect('dao'.length).toBe(AUTHOR_QUERY_MIN_LENGTH);
		expect(authorSearchTerm('dao')).toBe('dao');
	});

	it('trims surrounding whitespace', () => {
		expect(authorSearchTerm('  Tri Dao  ')).toBe('Tri Dao');
	});

	// Both refusals are measured, not hypothetical: against the production dataset,
	// `name match ("" + "*")` and `name match ("*" + "*")` each return ALL 123 people. Without these
	// the endpoint hands out the entire author vocabulary — the payload the text input exists to
	// avoid shipping in the first place.
	it.each([
		['null', null],
		['undefined', undefined],
		['empty', ''],
		['whitespace only', '   '],
		['one character', 'd'],
		['two characters', 'da'],
		['a bare wildcard', '*'],
		['wildcards that clean down to nothing', '**??'],
		['whitespace-padded short term', '  da  ']
	])('refuses %s', (_label, raw) => {
		expect(authorSearchTerm(raw)).toBeNull();
	});

	it('strips wildcards from an otherwise usable term', () => {
		expect(authorSearchTerm('Dao*')).toBe('Dao');
		expect(authorSearchTerm('D*a?o')).toBe('Dao');
	});

	// Length is judged AFTER cleaning, or `da*` would pass the floor on the strength of a character
	// that is then removed — a 2-letter query reaching GROQ through the back door.
	it('measures length after stripping, not before', () => {
		expect(authorSearchTerm('da*')).toBeNull();
	});
});

// The three accented authors in the corpus, with the folded key `pnpm promote` stores for each.
const author = (label: string, key: string | null, value = 'x'): AuthorOption => ({
	value,
	label,
	key
});
const LUKASZ = author('Łukasz Kaiser', 'lukasz kaiser', 'lukasz-kaiser');
const RE = author('Christopher Ré', 'christopher re', 'christopher-re');
const KONIGHOFER = author('Bettina Könighofer', 'bettina konighofer', 'bettina-konighofer');

describe('authorOptionLabel (DAR-105)', () => {
	// The whole point. Measured in headed chromium and firefox with both controls holding, a native
	// <datalist> filters by a case-insensitive SUBSTRING over code points, so `luk` matched nothing
	// in `Łukasz Kaiser` and no popup appeared at all. The label is the accent-blind match target.
	it.each([
		['Łukasz Kaiser', LUKASZ, 'luk'],
		['Christopher Ré', RE, 're'],
		['Bettina Könighofer', KONIGHOFER, 'koni']
	])('gives %s a label an English keyboard can reach', (_n, option, typed) => {
		const label = authorOptionLabel(option);
		expect(label).toBeDefined();
		expect(label!.toLowerCase()).toContain(typed);
	});

	// ...and the diacritic spelling has to keep working, which is why the label carries BOTH forms
	// rather than just the folded one. Firefox matches ONLY the label when one is present (measured),
	// so a label of `lukasz kaiser` alone would make `Łuk` stop offering him — trading one unreachable
	// spelling for another instead of fixing anything.
	it.each([
		['Łukasz Kaiser', LUKASZ, 'łuk'],
		['Christopher Ré', RE, 'ré'],
		['Bettina Könighofer', KONIGHOFER, 'könig']
	])('keeps %s reachable by the accented spelling too', (_n, option, typed) => {
		expect(authorOptionLabel(option)!.toLowerCase()).toContain(typed);
	});

	// 120 of the 123 authors. Emitting a label here would be a pure regression rather than a no-op,
	// because firefox DISPLAYS the label in place of the value — every one of them would start
	// rendering as its lowercased sort key.
	it('emits no label for a name that is already all-ASCII', () => {
		expect(authorOptionLabel(author('Tri Dao', 'tri dao', 'tri-dao'))).toBeUndefined();
		expect(authorOptionLabel(author('Albert Gu', 'albert gu', 'albert-gu'))).toBeUndefined();
	});

	// The key is a `production` publication artifact — `dev` has none, and so does anything written
	// past promote. Absence must degrade to the pre-DAR-105 rendering, never throw or emit `undefined`
	// into the attribute: same fail-safe polarity as the query's folded `match` arm.
	it('emits no label when the document carries no key', () => {
		expect(authorOptionLabel(author('Łukasz Kaiser', null))).toBeUndefined();
		expect(authorOptionLabel(author('Łukasz Kaiser', ''))).toBeUndefined();
	});

	// The condition is "does the key offer a spelling the name doesn't already have", NOT "is the
	// name accented" — so a name that folds to itself gets nothing, however non-ASCII it is. A CJK
	// name is the case: the fold is a no-op there, and a label would be pure noise in the dropdown.
	it('emits no label when the key adds no spelling the name lacks', () => {
		expect(authorOptionLabel(author('张三', '张三', 'zhang-san'))).toBeUndefined();
		expect(authorOptionLabel(author('Łukasz Kaiser', 'łukasz kaiser'))).toBeUndefined();
	});

	// ...and the same phrasing catches a case an accent test would MISS, which is why it is phrased
	// that way. `sortKey` collapses whitespace, so a name with a double space has a key the name does
	// not contain: the server matches `tri d` through the key, and without a label the browser —
	// which substring-matches the value — would hide the row the server just found. This is the one
	// hole that keeps the containment guarantee structural rather than a fact about today's corpus.
	it('emits a label when only whitespace differs, closing the substring gap', () => {
		const label = authorOptionLabel(author('Tri  Dao', 'tri dao', 'tri-dao'));
		expect(label).toBe('Tri  Dao (tri dao)');
		expect(label!.toLowerCase()).toContain('tri d');
	});

	// Case alone is not a difference the browser can see — its matching is case-insensitive — so a
	// key that differs from the name only in case must not trigger a label.
	it('treats a case-only difference as adding nothing', () => {
		expect(authorOptionLabel(author('Tri Dao', 'TRI DAO', 'tri-dao'))).toBeUndefined();
	});

	// `label` is typed `string`, and the cast below is the point: `teamAuthors` projects
	// `"label": name` with no `defined(name)` filter, its `kind != "external"` is fail-OPEN, and a
	// required field in the Studio is a UI affordance an API write skips (DAR-70). So a nameless
	// person reaches this as `null` while TypeScript says it cannot — and that seed list renders on
	// EVERY /research load, server-side, so a throw here is the whole page rather than one missing
	// suggestion. There are no such documents today; this is about which way the code fails if one
	// appears.
	it('survives a null name that the type says is impossible', () => {
		const nameless = { value: 'x', label: null, key: 'michael harris' } as unknown as AuthorOption;
		expect(() => authorOptionLabel(nameless)).not.toThrow();
		expect(authorOptionLabel(nameless)).toBeUndefined();
	});

	// NFD + strip-combining-marks is the reflex fix, and it is the one that fails: `Ł` (U+0141) has no
	// decomposition (DAR-95). Asserted here so the reason the fold is READ from the document rather
	// than derived in the browser stays visible — this is what a hand-rolled normalizer would ship.
	it('is not something NFD could have derived', () => {
		const stripped = 'Łukasz Kaiser'.normalize('NFD').replace(/\p{Diacritic}/gu, '');
		expect(stripped.toLowerCase()).not.toContain('luk');
		expect(authorOptionLabel(LUKASZ)!.toLowerCase()).toContain('luk');
	});

	it('contains both strings the server matches on, whole', () => {
		const label = authorOptionLabel(LUKASZ)!;
		expect(label).toContain(LUKASZ.label);
		expect(label).toContain(LUKASZ.key!);
	});

	// THE property, asserted as one rather than spot-checked: the suggestion list must never offer
	// LESS than the filter finds. The browser compares a SUBSTRING of the label when one is present
	// and of the value (the name) when not — so whatever the visitor typed has to be contained in
	// that target, or the row the server returned is dropped before anyone sees it.
	//
	// Scoped to CONTIGUOUS runs of either field, and the scope is the honest part. GROQ's `match`
	// tokenizes, so `kaiser luk` matches `Łukasz Kaiser` on the server while no substring test could
	// ever find it — that gap is inherent to the native control, identical before and after DAR-105,
	// and not something this function claims to close. What it does claim: anything a visitor could
	// read off the name or the folded key and type straight through, spaces included, still matches.
	//
	// Both branches hold by construction, which is why the emit condition is a containment test: with
	// a label it holds because the label carries both strings whole, and without one it holds because
	// "no label" MEANS the name already contains the key. Enumerating proves it rather than restating
	// it — and it is what catches the whitespace case, where a single-token check cannot: `Tri  Dao`
	// has key `tri dao`, the server matches `tri d`, and the raw name does not contain it.
	const contiguousRuns = (s: string) => {
		const t = s.toLowerCase();
		const runs: string[] = [];
		for (let i = 0; i < t.length; i++)
			for (let j = i + 1; j <= t.length; j++) runs.push(t.slice(i, j));
		return runs;
	};

	it.each([
		['accented', LUKASZ],
		['accented', RE],
		['accented', KONIGHOFER],
		['plain ASCII', author('Tri Dao', 'tri dao', 'tri-dao')],
		['collapsed whitespace', author('Tri  Dao', 'tri dao', 'tri-dao')],
		['ligature fold', author('Straße Ørsted', 'strasse orsted', 'strasse-orsted')],
		['folds to itself', author('张三', '张三', 'zhang-san')],
		['no key at all', author('Łukasz Kaiser', null, 'lukasz-kaiser')]
	])('never hides a %s row the server would have returned', (_n, option) => {
		// What the browser compares: the label if we emit one, otherwise the option's value.
		const target = (authorOptionLabel(option) ?? option.label).toLowerCase();
		const typeable = [...contiguousRuns(option.label), ...contiguousRuns(option.key ?? '')];
		expect(typeable.length).toBeGreaterThan(0);
		for (const term of typeable) expect(target).toContain(term);
	});
});
