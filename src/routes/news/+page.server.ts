import { redirect } from '@sveltejs/kit';
import { PAGE_SIZE, pageHref, pageOffset, pageWindow, parsePageParam } from '$lib/pagination';
import { getSanityClient } from '$lib/server/sanity';
import { postsPageQuery } from '$lib/sanity/queries';
import type { PostsPageQueryResult } from '$lib/sanity/types';
import type { PageServerLoad } from './$types';

// One page of published posts for the /news feed (DAR-94). The easy half of the pagination work:
// /news has no facets, so there is no vocabulary to move out of the fetched set — just a slice, a
// total, and the shared page window.
//
// Read-only, token-less, from the public dataset (see sanity/client.ts). The fetch stays wrapped so
// a Sanity outage degrades to an empty feed + a log line rather than 500-ing a marketing page — the
// page renders its shell/empty-state either way.
const EMPTY: PostsPageQueryResult = { posts: [], total: 0 };

export const load: PageServerLoad = async ({ url }) => {
	const requested = parsePageParam(url.searchParams);
	const offset = pageOffset(requested);

	let result = EMPTY;
	try {
		result = await getSanityClient().fetch(postsPageQuery, { offset, end: offset + PAGE_SIZE });
	} catch (err) {
		console.warn('[sanity] /news list fetch failed:', err);
	}

	const window = pageWindow(requested, result.total);
	// See the /research load: a page past the end renders as an empty feed, which reads as "no posts"
	// rather than "no such page". Page 1 is always in range, so the normal path never redirects.
	if (window.outOfRange) redirect(302, pageHref(url, window.pageCount));

	return { ...result, page: window.page, pageCount: window.pageCount };
};
