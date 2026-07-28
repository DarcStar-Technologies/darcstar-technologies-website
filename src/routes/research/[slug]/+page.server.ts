import { error } from '@sveltejs/kit';
import { getSanityClient } from '$lib/server/sanity';
import { renderMathIn } from '$lib/server/math';
import { paperBySlugQuery } from '$lib/sanity/queries';
import type { PageServerLoad } from './$types';

// A single published paper. Missing slug → 404; infra failure propagates (500). See /news/[slug],
// including why the commentary's math is typeset here rather than in the component.
export const load: PageServerLoad = async ({ params }) => {
	const paper = await getSanityClient().fetch(paperBySlugQuery, { slug: params.slug });
	if (!paper) error(404);
	return { paper: { ...paper, commentary: renderMathIn(paper.commentary) } };
};
