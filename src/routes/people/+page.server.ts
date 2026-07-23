import { getSanityClient } from '$lib/server/sanity';
import { peopleQuery } from '$lib/sanity/queries';
import type { PageServerLoad } from './$types';

// The team (Sanity `person` where kind != "external") for /people. External co-authors are
// deliberately excluded (they show up inline on the papers they authored, not on the team page); a
// person with an unset `kind` still counts as team (see peopleQuery).
// Same resilience posture as the other list loads: empty grid, never a 500, if Sanity is unreachable.
export const load: PageServerLoad = async () => {
	try {
		const people = await getSanityClient().fetch(peopleQuery);
		return { people };
	} catch (err) {
		console.warn('[sanity] /people list fetch failed:', err);
		return { people: [] };
	}
};
