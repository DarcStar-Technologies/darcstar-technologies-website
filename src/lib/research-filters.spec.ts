import { describe, expect, it, vi } from 'vitest';
import {
	buildFilterQuery,
	filterPapers,
	hasActiveFilters,
	paperFacets,
	parseResearchFilters,
	researchTopicHref,
	sortPapers,
	type PaperRow
} from './research-filters';

// researchTopicHref localizes via the Paraglide runtime, whose getLocale() needs a request /
// browser context this bare unit environment lacks. Identity-mock it: these tests pin the
// PATH + PARAM shape (the drift rail); locale prefixing is Paraglide's, covered by e2e.
vi.mock('$lib/paraglide/runtime', () => ({ localizeHref: (href: string) => href }));

// Minimal PaperRow stand-ins — only the fields the filter logic touches; the cast keeps the
// fixtures honest against renames without dragging in every projected field.
const paper = (over: {
	_id: string;
	title: string;
	darcstarAuthored?: boolean | null;
	publishedDate?: string | null;
	topics?: { slug: string | null; title: string }[] | null;
	authors?: { slug: string | null; name: string }[] | null;
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
	darcstarAuthored: true,
	topics: [{ slug: 'safety', title: 'Provable Safety' }],
	authors: [{ slug: 'm-harris', name: 'M. Harris' }]
});
const attention = paper({
	_id: 'p2',
	title: 'Attention Is All You Need',
	darcstarAuthored: false,
	topics: [{ slug: 'transformers', title: 'Transformer Architecture' }],
	authors: [{ slug: 'a-vaswani', name: 'A. Vaswani' }]
});
const flash = paper({
	_id: 'p3',
	title: 'FlashAttention',
	// Unset origin — must count as external (DAR-52 fail-safe polarity).
	topics: [
		{ slug: 'transformers', title: 'Transformer Architecture' },
		{ slug: null, title: 'Slugless Topic' }
	],
	authors: [{ slug: 't-dao', name: 'T. Dao' }]
});
const all = [gide, attention, flash];

describe('parseResearchFilters', () => {
	it('defaults everything with no params', () => {
		expect(parseResearchFilters(new URLSearchParams())).toEqual({
			topic: null,
			author: null,
			origin: null,
			sort: 'date'
		});
	});

	it('treats empty-string params (no-JS GET submit) as unset', () => {
		const f = parseResearchFilters(new URLSearchParams('topic=&author=&origin=&sort='));
		expect(f).toEqual({ topic: null, author: null, origin: null, sort: 'date' });
		expect(hasActiveFilters(f)).toBe(false);
	});

	it('rejects unknown origin/sort values instead of trusting the URL', () => {
		const f = parseResearchFilters(new URLSearchParams('origin=bogus&sort=venue'));
		expect(f.origin).toBeNull();
		expect(f.sort).toBe('date');
	});

	it('accepts the date-asc sort and reports it active', () => {
		const f = parseResearchFilters(new URLSearchParams('sort=date-asc'));
		expect(f.sort).toBe('date-asc');
		expect(hasActiveFilters(f)).toBe(true);
	});

	it('accepts the full valid set and reports it active', () => {
		const f = parseResearchFilters(
			new URLSearchParams('topic=transformers&author=a-vaswani&origin=external&sort=title')
		);
		expect(f).toEqual({
			topic: 'transformers',
			author: 'a-vaswani',
			origin: 'external',
			sort: 'title'
		});
		expect(hasActiveFilters(f)).toBe(true);
	});
});

describe('filterPapers', () => {
	const base = { topic: null, author: null, origin: null, sort: 'date' } as const;

	it('passes everything through with no active filters', () => {
		expect(filterPapers(all, { ...base })).toEqual(all);
	});

	it('filters by topic slug', () => {
		expect(filterPapers(all, { ...base, topic: 'transformers' })).toEqual([attention, flash]);
	});

	it('filters by author slug', () => {
		expect(filterPapers(all, { ...base, author: 'm-harris' })).toEqual([gide]);
	});

	it('origin=darcstar returns only explicitly first-party papers', () => {
		expect(filterPapers(all, { ...base, origin: 'darcstar' })).toEqual([gide]);
	});

	it('origin=external includes unset darcstarAuthored (fail-safe polarity)', () => {
		expect(filterPapers(all, { ...base, origin: 'external' })).toEqual([attention, flash]);
	});

	it('combines facets conjunctively', () => {
		expect(filterPapers(all, { ...base, topic: 'transformers', author: 'a-vaswani' })).toEqual([
			attention
		]);
	});

	it('tolerates null topics/authors arrays', () => {
		const bare = paper({ _id: 'p4', title: 'Bare' });
		expect(filterPapers([bare], { ...base, topic: 'transformers' })).toEqual([]);
		expect(filterPapers([bare], { ...base, author: 'm-harris' })).toEqual([]);
		expect(filterPapers([bare], { ...base, origin: 'external' })).toEqual([bare]);
	});
});

describe('sortPapers', () => {
	it('keeps the query order (publishedDate desc) for the date sort', () => {
		expect(sortPapers(all, 'date')).toBe(all);
	});

	it('sorts by title A→Z without mutating the input', () => {
		const sorted = sortPapers(all, 'title');
		expect(sorted.map((p) => p.title)).toEqual([
			'Attention Is All You Need',
			'FlashAttention',
			'GIDE: Guaranteed Intelligent Dynamics'
		]);
		expect(all[0]).toBe(gide);
	});

	it('threads the locale into the title collation', () => {
		const eñe = paper({ _id: 'p5', title: 'ñandú control' });
		const n = paper({ _id: 'p6', title: 'nz systems' });
		const z = paper({ _id: 'p7', title: 'zeta' });
		// Spanish traditional-adjacent collation still interleaves ñ with n (ñandú < nz would be
		// true under strict 'traditional' but modern es sorts ñ AFTER n); the load-bearing bit is
		// that the locale parameter reaches localeCompare without throwing and yields a stable,
		// locale-defined order rather than raw code-point order (where ñ would sort after z).
		const sorted = sortPapers([z, eñe, n], 'title', 'es');
		expect(sorted.map((p) => p._id)).toEqual(['p6', 'p5', 'p7']);
	});

	it('date-asc sorts oldest first with undated papers last', () => {
		const oldest = paper({ _id: 'd1', title: 'Oldest', publishedDate: '2017-06-12' });
		const newest = paper({ _id: 'd2', title: 'Newest', publishedDate: '2024-07-11' });
		const undated = paper({ _id: 'd3', title: 'Undated' });
		const input = [newest, undated, oldest];
		expect(sortPapers(input, 'date-asc').map((p) => p._id)).toEqual(['d1', 'd2', 'd3']);
		expect(input[0]).toBe(newest);
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
			buildFilterQuery(values({ topic: 'transformers', author: '', origin: '', sort: '' }))
		).toBe('topic=transformers');
	});

	it('returns an empty string when nothing is set', () => {
		expect(buildFilterQuery(values({}))).toBe('');
	});

	it('ignores unknown keys', () => {
		expect(buildFilterQuery(values({ evil: 'x', sort: 'title' }))).toBe('sort=title');
	});
});

describe('paperFacets', () => {
	it('dedupes by slug, sorts by label, and skips slugless entries', () => {
		const { topics, authors } = paperFacets(all);
		expect(topics).toEqual([
			{ value: 'safety', label: 'Provable Safety' },
			{ value: 'transformers', label: 'Transformer Architecture' }
		]);
		// Label-sorted (A. Vaswani, M. Harris, T. Dao), not value-sorted.
		expect(authors.map((a) => a.value)).toEqual(['a-vaswani', 'm-harris', 't-dao']);
	});

	it('returns empty facets for an empty index', () => {
		expect(paperFacets([])).toEqual({ topics: [], authors: [] });
	});
});
