import { getSanityClient } from '$lib/server/sanity';
import { papersQuery } from '$lib/sanity/queries';
import type { PageServerLoad } from './$types';

// Published papers/preprints for the /research index. Same posture as /news: token-less public read,
// degrade to an empty list (never 500) if Sanity is unreachable.
export const load: PageServerLoad = async () => {
	try {
		const papers = await getSanityClient().fetch(papersQuery);
		return { papers };
	} catch (err) {
		console.warn('[sanity] /research list fetch failed:', err);
		return { papers: [] };
	}
};
