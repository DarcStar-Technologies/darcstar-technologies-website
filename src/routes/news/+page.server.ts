import { getSanityClient } from '$lib/server/sanity';
import { postsQuery } from '$lib/sanity/queries';
import type { PageServerLoad } from './$types';

// Published posts for the /news feed. Read-only, token-less, from the public dataset (see
// sanity/client.ts). The fetch is wrapped so a Sanity outage degrades to an empty feed + a log line
// rather than 500-ing a marketing page — the page renders its shell/empty-state either way.
export const load: PageServerLoad = async () => {
	try {
		const posts = await getSanityClient().fetch(postsQuery);
		return { posts };
	} catch (err) {
		console.warn('[sanity] /news list fetch failed:', err);
		return { posts: [] };
	}
};
