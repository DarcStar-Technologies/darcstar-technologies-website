import { localizeHref } from '$lib/paraglide/runtime';
import type { PapersQueryResult } from '$lib/sanity/types';

// Pure filter/sort/facet logic for the /research index. URL query params are the single source
// of state (?topic=&author=&origin=&sort=) so filtered views are shareable, SSR-render without
// JS (GET form), and survive reloads; the page derives everything below from the ONE papers
// fetch — no per-filter Sanity round trips. Kept out of the component so the semantics are
// unit-testable without a DOM.
//
// Scale: the index is un-paginated — every published paper is fetched and rendered per request.
// Everything here is therefore written as a SINGLE pass over the corpus and nothing walks it
// twice. Measured on the page's full re-derive (facets + filter + sort + partition), synthetic
// papers carrying 3 topics and 2 authors each: 0.14 ms at 100 papers, 0.49 ms at 300, 1.4 ms at
// 1000 — so this layer is not what will hurt.
//
// What WILL, and what this module can't fix, sits upstream: `papersQuery` ships every
// abstract/author/topic on every SSR request, and the page renders a card per paper. Bounding
// those means GROQ-side filtering + pagination, which changes this module's contract too — facets
// can no longer derive from the fetched set once that set is one page of the corpus.

export type PaperRow = PapersQueryResult[number];

// The param-name contract, defined ONCE: parse/build below, the form's select `name`s, and
// the topic-tag link URLs all consume this — rename here or drift silently between the JS and
// no-JS paths.
export const FILTER_PARAM = {
	topic: 'topic',
	author: 'author',
	origin: 'origin',
	sort: 'sort'
} as const;

export type ResearchOrigin = 'darcstar' | 'external';
export type ResearchSort = 'date' | 'date-asc' | 'title';

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

/** A research topic in use by at least one paper, with the Studio's authored `description`. */
export interface TopicEntry {
	slug: string;
	title: string;
	description: string | null;
}

// Tolerant by design: a no-JS GET submit sends empty strings for untouched selects (→ null),
// and hand-edited URLs may carry junk (unknown origin/sort values fall back safely).
export function parseResearchFilters(params: URLSearchParams): ResearchFilters {
	const origin = params.get(FILTER_PARAM.origin);
	const sort = params.get(FILTER_PARAM.sort);
	return {
		topic: params.get(FILTER_PARAM.topic) || null,
		author: params.get(FILTER_PARAM.author) || null,
		origin: origin === 'darcstar' || origin === 'external' ? origin : null,
		sort: sort === 'title' || sort === 'date-asc' ? sort : 'date'
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
	for (const key of Object.values(FILTER_PARAM)) {
		const v = values.get(key);
		if (typeof v === 'string' && v) params.set(key, v);
	}
	return params.toString();
}

// The one place the topic-tag → filtered-list URL shape lives; both /research card tags and
// the detail page's tags link through this, so the param name can't drift from the parser's.
export function researchTopicHref(slug: string): string {
	return localizeHref(`/research?${FILTER_PARAM.topic}=${encodeURIComponent(slug)}`);
}

// The DAR-52 fail-safe polarity, in ONE place: only an explicit flag makes a paper ours, so an
// unset/null value stays third-party. Both the origin filter and the section split read it, and
// they used to spell it out separately (`!!p.darcstarAuthored`, `p.darcstarAuthored`,
// `!p.darcstarAuthored`) — three chances for the safe direction to drift.
export function isDarcstarAuthored(paper: PaperRow): boolean {
	return paper.darcstarAuthored === true;
}

// Conjunctive (AND) across facets.
export function filterPapers(papers: PaperRow[], f: ResearchFilters): PaperRow[] {
	return papers.filter(
		(p) =>
			(!f.topic || (p.topics ?? []).some((t) => t.slug === f.topic)) &&
			(!f.author || (p.authors ?? []).some((a) => a.slug === f.author)) &&
			(!f.origin || (f.origin === 'darcstar') === isDarcstarAuthored(p))
	);
}

// The origin split as a single partition rather than two `.filter()` walks of the same list —
// order-preserving, so each section keeps whatever order sortPapers established.
export function partitionByOrigin(papers: PaperRow[]): {
	darcstar: PaperRow[];
	external: PaperRow[];
} {
	const darcstar: PaperRow[] = [];
	const external: PaperRow[] = [];
	for (const p of papers) (isDarcstarAuthored(p) ? darcstar : external).push(p);
	return { darcstar, external };
}

// 'date' keeps the query's publishedDate-desc order (GROQ already sorted it — don't re-sort,
// undated papers stay where the query put them); 'date-asc' is an explicit oldest-first sort
// with undated papers LAST (a plain reverse would surface them first); 'title' is a
// locale-aware A→Z copy. Both re-sorts copy — the input is never mutated.
export function sortPapers(papers: PaperRow[], sort: ResearchSort, locale?: string): PaperRow[] {
	if (sort === 'title') {
		return [...papers].sort((a, b) =>
			a.title.localeCompare(b.title, locale, { sensitivity: 'base' })
		);
	}
	if (sort === 'date-asc') {
		return [...papers].sort((a, b) => {
			if (!a.publishedDate) return 1;
			if (!b.publishedDate) return -1;
			return a.publishedDate.localeCompare(b.publishedDate);
		});
	}
	return papers;
}

// Everything the /research chrome derives from the corpus, in ONE pass over it. Topics and
// authors were two walks (and topics briefly three, because the guide and the select each asked
// for them); at hundreds of papers that is pure waste, and worse, it let "which topics does this
// index have" be answered by two different loops.
//
// Facets come from the papers themselves (deduped by slug, label-sorted), so the topic and author
// selects only ever offer values matching at least one paper — origin/sort are static option sets
// and that guarantee is theirs alone. Entries without a slug can't round-trip through a URL and
// are skipped, which is why the topic guide can't link a slugless topic either.
//
// `topics` comes back as full entries rather than select options because its two consumers want
// different projections: the guide renders the authored `description`, a `<select>` has nowhere
// to put one. Carried through as-is (null when the editor left it blank) — deciding what an
// undescribed topic means belongs to the renderer.
export interface PaperFacets {
	topics: TopicEntry[];
	authors: FacetOption[];
}

export function paperFacets(papers: PaperRow[]): PaperFacets {
	const topics = new Map<string, TopicEntry>();
	const authors = new Map<string, string>();
	for (const p of papers) {
		for (const t of p.topics ?? []) {
			if (t.slug) topics.set(t.slug, { slug: t.slug, title: t.title, description: t.description });
		}
		for (const a of p.authors ?? []) if (a.slug) authors.set(a.slug, a.name);
	}
	return {
		topics: [...topics.values()].sort((a, b) => a.title.localeCompare(b.title)),
		authors: [...authors.entries()]
			.map(([value, label]) => ({ value, label }))
			.sort((a, b) => a.label.localeCompare(b.label))
	};
}

/** Projects topic entries down to the Topic select's option shape. */
export function topicOptions(topics: TopicEntry[]): FacetOption[] {
	return topics.map((t) => ({ value: t.slug, label: t.title }));
}
