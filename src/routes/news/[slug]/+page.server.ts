import { error } from '@sveltejs/kit';
import { getSanityClient } from '$lib/server/sanity';
import { postBySlugQuery } from '$lib/sanity/queries';
import type { PageServerLoad } from './$types';

// A single published post. A genuine "no such slug" → 404 (the +error page); a transient Sanity/infra
// failure is left to propagate (500) rather than being masked as a 404 — only a real miss is a miss.
export const load: PageServerLoad = async ({ params }) => {
	const post = await getSanityClient().fetch(postBySlugQuery, { slug: params.slug });
	if (!post) error(404);
	return { post };
};
