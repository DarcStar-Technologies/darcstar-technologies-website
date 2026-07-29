import { error } from '@sveltejs/kit';
import { getSanityClient } from '$lib/server/sanity';
import { renderMathIn } from '$lib/server/math';
import { personBySlugQuery } from '$lib/sanity/queries';
import type { PageServerLoad } from './$types';

// One team member's profile (DAR-122). Missing slug — or an external co-author, whom
// personBySlugQuery's filter excludes — is a 404; an infra failure propagates (500).
//
// NOT the resilient try/catch posture the /people grid takes. That one degrades a Sanity outage to an
// empty grid because the page still says something (its hero, its heading). This page IS the person,
// so a "profile with nothing in it" would be worse than an error: it reads as a real page about
// someone with no history, and a crawler would happily index it.
//
// `fullBio` is `blockContent`, so its math is typeset here rather than in the component — see
// /news/[slug] for the measurement, and $lib/server/math.ts for why that lives on the server. The
// rendered type requires `html` on every math node, so forgetting this call is a `pnpm check` error.
export const load: PageServerLoad = async ({ params }) => {
	const person = await getSanityClient().fetch(personBySlugQuery, { slug: params.slug });
	if (!person) error(404);
	return { person: { ...person, fullBio: renderMathIn(person.fullBio) } };
};
