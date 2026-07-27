import { redirect } from '@sveltejs/kit';
import { PAGE_SIZE, pageHref, pageOffset, pageWindow, parsePageParam } from '$lib/pagination';
import { parseResearchFilters, type ResearchSort } from '$lib/research-filters';
import { getSanityClient } from '$lib/server/sanity';
import {
	papersPageByDateAscQuery,
	papersPageByDateQuery,
	papersPageByTitleQuery
} from '$lib/sanity/queries';
import type { PapersPageByDateQueryResult } from '$lib/sanity/types';
import type { PageServerLoad } from './$types';

// One page of published papers for the /research index, plus the totals and the facet vocabulary,
// in a single Sanity round trip (DAR-94).
//
// This load READS THE URL, which the un-paginated one deliberately did not: filtering, sorting and
// the facets all happened in the component over a fetch of the whole corpus, so a query-only
// navigation cost nothing. It cannot work that way once the fetch is one page — a filter applied to
// 20 rows is not the same answer as a filter applied to the corpus — so a filter or page change is
// now a Sanity round trip (~235 ms measured; the page's enhancement already debounces changes by
// 250 ms, and SvelteKit keeps the previous render on screen meanwhile). That is what bounding the
// payload costs, not an oversight.
//
// Same resilience posture as before: token-less public read, degrade to an empty index and a log
// line rather than 500-ing a marketing page.

// One shape for all three sort variants. The three `…Result` types are generated separately but are
// structurally identical by construction (the queries share every const except the `order()`
// clause), so this annotation catches a projection that LOSES or renames a field in one variant —
// the union stops being assignable and `pnpm check` fails.
//
// It does NOT catch a field ADDED to one variant: excess properties are legal in a non-literal
// assignment, so the wider type still satisfies this one (measured — `pnpm check` passed with
// `_updatedAt` added to the title query alone). The guard that covers every drift, including an
// edit to a FILTER predicate that changes no type at all, is the byte-identical comparison in
// queries.spec.ts. Don't mistake this annotation for that.
type PapersPage = PapersPageByDateQueryResult;

// A factory, not a shared const: the returned object is spread into the load's result, so a shared
// literal would hand every failing request the same `papers`/`topics` arrays. Nothing mutates them
// today, which is exactly the kind of thing that stops being true quietly.
const empty = (): PapersPage => ({
	papers: [],
	total: 0,
	totalAll: 0,
	topics: [],
	teamAuthors: [],
	authorLabel: null
});

// The sort selects the query, because GROQ's `order()` cannot be parameterised — three literals is
// the price of keeping `client.fetch()` statically typed (see the note in queries.ts on why a
// query-building function silently degrades the result to `any`).
function fetchPapersPage(
	sort: ResearchSort,
	params: { topic: string | null; author: string | null; origin: string | null; offset: number }
): Promise<PapersPage> {
	const query =
		sort === 'title'
			? papersPageByTitleQuery
			: sort === 'date-asc'
				? papersPageByDateAscQuery
				: papersPageByDateQuery;
	return getSanityClient().fetch(query, { ...params, end: params.offset + PAGE_SIZE });
}

export const load: PageServerLoad = async ({ url }) => {
	const filters = parseResearchFilters(url.searchParams);
	const requested = parsePageParam(url.searchParams);

	let result = empty();
	try {
		result = await fetchPapersPage(filters.sort, {
			topic: filters.topic,
			author: filters.author,
			origin: filters.origin,
			offset: pageOffset(requested)
		});
	} catch (err) {
		console.warn('[sanity] /research list fetch failed:', err);
	}

	const view = pageWindow(requested, result.total);
	// `?page=99` on a 7-page index would otherwise render a card-less page under a filter bar, which
	// reads as "no results" rather than "no such page". The redirect costs one wasted query, and only
	// on a URL nothing on the site produces — page 1 is always in range, so the normal path never
	// reaches it. 302, not 301: which page is last changes as papers are published.
	if (view.outOfRange) redirect(302, pageHref(url, view.pageCount));

	return {
		...result,
		page: view.page,
		pageCount: view.pageCount,
		from: view.from,
		to: view.to
	};
};
