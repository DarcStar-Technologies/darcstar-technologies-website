import type { PapersQueryResult } from '$lib/sanity/types';

// Pure filter/sort/facet logic for the /research index. URL query params are the single source
// of state (?topic=&author=&origin=&sort=) so filtered views are shareable, SSR-render without
// JS (GET form), and survive reloads; the page derives everything below from the ONE papers
// fetch — no per-filter Sanity round trips. Kept out of the component so the semantics are
// unit-testable without a DOM.

export type PaperRow = PapersQueryResult[number];

export type ResearchOrigin = 'darcstar' | 'external';
export type ResearchSort = 'date' | 'title';

export interface ResearchFilters {
	topic: string | null;
	author: string | null;
	origin: ResearchOrigin | null;
	sort: ResearchSort;
}

/** One `<option>` of a facet select: `value` is the slug carried in the URL. */
export interface FacetOption {
	value: string;
	label: string;
}

// Tolerant by design: a no-JS GET submit sends empty strings for untouched selects (→ null),
// and hand-edited URLs may carry junk (unknown origin/sort values fall back safely).
export function parseResearchFilters(params: URLSearchParams): ResearchFilters {
	const origin = params.get('origin');
	return {
		topic: params.get('topic') || null,
		author: params.get('author') || null,
		origin: origin === 'darcstar' || origin === 'external' ? origin : null,
		sort: params.get('sort') === 'title' ? 'title' : 'date'
	};
}

export function hasActiveFilters(f: ResearchFilters): boolean {
	return f.topic !== null || f.author !== null || f.origin !== null || f.sort !== 'date';
}

// Builds the canonical query string from the filter form's values (the JS enhancement path).
// Only set values carry through — and sort's default ('' option) stays out — so enhanced URLs
// remain clean (?topic=x, never ?author=&origin=). Lives here (not the component) so it's
// unit-testable and the transient URLSearchParams stays out of Svelte-file lint scope.
export function buildFilterQuery(values: { get(name: string): FormDataEntryValue | null }): string {
	const params = new URLSearchParams();
	for (const key of ['topic', 'author', 'origin', 'sort'] as const) {
		const v = values.get(key);
		if (typeof v === 'string' && v) params.set(key, v);
	}
	return params.toString();
}

// Conjunctive (AND) across facets. Origin uses the DAR-52 fail-safe polarity: anything not
// explicitly darcstarAuthored counts as external.
export function filterPapers(papers: PaperRow[], f: ResearchFilters): PaperRow[] {
	return papers.filter(
		(p) =>
			(!f.topic || (p.topics ?? []).some((t) => t.slug === f.topic)) &&
			(!f.author || (p.authors ?? []).some((a) => a.slug === f.author)) &&
			(!f.origin || (f.origin === 'darcstar') === !!p.darcstarAuthored)
	);
}

// 'date' keeps the query's publishedDate-desc order (GROQ already sorted it — don't re-sort,
// undated papers stay where the query put them); 'title' is a locale-aware A→Z copy.
export function sortPapers(papers: PaperRow[], sort: ResearchSort, locale?: string): PaperRow[] {
	if (sort !== 'title') return papers;
	return [...papers].sort((a, b) =>
		a.title.localeCompare(b.title, locale, { sensitivity: 'base' })
	);
}

// Facet options come from the papers themselves (deduped by slug, label-sorted), so the selects
// only ever offer values that match at least one paper. Entries without a slug can't round-trip
// through a URL and are skipped.
export function paperFacets(papers: PaperRow[]): { topics: FacetOption[]; authors: FacetOption[] } {
	const topics = new Map<string, string>();
	const authors = new Map<string, string>();
	for (const p of papers) {
		for (const t of p.topics ?? []) if (t.slug) topics.set(t.slug, t.title);
		for (const a of p.authors ?? []) if (a.slug) authors.set(a.slug, a.name);
	}
	const toOptions = (m: Map<string, string>): FacetOption[] =>
		[...m.entries()].map(([value, label]) => ({ value, label }));
	return {
		topics: toOptions(topics).sort((a, b) => a.label.localeCompare(b.label)),
		authors: toOptions(authors).sort((a, b) => a.label.localeCompare(b.label))
	};
}
