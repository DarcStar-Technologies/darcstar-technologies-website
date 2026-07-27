import { localizeHref } from '$lib/paraglide/runtime';
import type { PapersPageByDateQueryResult } from '$lib/sanity/types';

// URL-param semantics for the /research index. Query params are the single source of state
// (?topic=&author=&origin=&sort=&page=) so filtered views are shareable, SSR-render without JS
// (native GET form), and survive reloads. Kept out of the component so they are unit-testable
// without a DOM.
//
// DAR-94 moved the WORK these params describe into GROQ. Filtering, sorting and the facet
// vocabulary all used to happen here, over a fetch of the entire corpus. The index is paginated
// now, so the fetched set is one page — and none of the three can be derived from one page: a Topic
// select built from 20 papers offers 20 papers' worth of topics, and sorting a page sorts within it
// rather than across the corpus. What remains is the half that was always about the URL rather than
// the data, plus the two derivations that still act legitimately on a page of rows
// (`isDarcstarAuthored`, `partitionByOrigin`).
//
// Page-window arithmetic lives in $lib/pagination.ts, shared with /news.

export type PaperRow = PapersPageByDateQueryResult['papers'][number];

// The param-name contract, defined ONCE: parse/build below, the form's control `name`s, and
// the topic-tag link URLs all consume this — rename here or drift silently between the JS and
// no-JS paths.
//
// `page` is deliberately NOT a member (it lives in $lib/pagination.ts), and that omission is what
// implements "changing a filter returns you to page 1": `buildFilterQuery` only emits keys it finds
// here, so the JS path cannot carry a stale page forward, and the no-JS path is a native GET form,
// which replaces the whole query string with its own fields. Adding `page` here would silently
// strand a visitor on page 7 of a filter that now has two results.
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

/** Projects the topic facet down to the Topic select's option shape. */
export function topicOptions(topics: TopicEntry[]): FacetOption[] {
	return topics.map((t) => ({ value: t.slug, label: t.title }));
}

/**
 * Characters a visitor must type before the author control asks the server for suggestions.
 *
 * Shared by the input (which debounces up to this length) and by
 * `/research/authors.json` (which refuses below it), so the floor cannot hold in one place and not
 * the other — and the endpoint's copy is the one that matters, since nothing stops a caller from
 * requesting it directly.
 */
export const AUTHOR_QUERY_MIN_LENGTH = 3;

/**
 * A raw author-search string → the term to hand GROQ's `match`, or null when it is too short to
 * answer. Both cleanups are load-bearing rather than defensive, measured against production:
 * `match ("" + "*")` and `match ("*" + "*")` each hit ALL 123 people in the dataset, so an
 * unfiltered term turns a lookup into a dump of the entire author vocabulary — which is the exact
 * payload this control exists to avoid shipping.
 *
 * The wildcards are stripped rather than rejected: someone typing `Dao*` means Dao, and answering
 * an intelligible query is friendlier than refusing it. (There is no injection risk to guard
 * against — GROQ params are bound, not interpolated; this is about the PATTERN's semantics.)
 */
export function authorSearchTerm(raw: string | null | undefined): string | null {
	const cleaned = (raw ?? '').replace(/[*?]/g, '').trim();
	return cleaned.length >= AUTHOR_QUERY_MIN_LENGTH ? cleaned : null;
}
