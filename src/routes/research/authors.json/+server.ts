import { json } from '@sveltejs/kit';
import { authorSearchTerm } from '$lib/research-filters';
import { getSanityClient } from '$lib/server/sanity';
import { authorSuggestionsQuery } from '$lib/sanity/queries';
import type { RequestHandler } from './$types';

// Type-ahead for the /research author filter (DAR-94). The author vocabulary is the one facet
// pagination does not make flat — it grows ~7 people per paper and never plateaus (measured: 123
// distinct authors across 18 papers, against 134 author slots), so shipping it as <option>s would
// cost ~96 KB of JSON on every request at 300 papers, several times the page it sits above. The
// control is a text input instead, and this answers it.
//
// Named `authors.json`, not `authors`, mirroring `sitemap.xml/+server.ts`: a dotted segment cannot
// shadow `/research/[slug]`, because Sanity's slugifier never produces one. `reroute`
// (src/hooks.ts) de-localizes, so this one path serves `/es/research` too.
//
// A GET of public data, so there is nothing to authorize — but the LENGTH FLOOR is a real boundary
// rather than a nicety, and it is enforced here rather than only in the browser, since nothing stops
// a caller from requesting this directly. Measured against production, `name match ("" + "*")` and
// `name match ("*" + "*")` each return ALL 123 people, so without it this endpoint would hand out
// the exact vocabulary the text input exists to avoid shipping. `authorSearchTerm` owns both the
// floor and the wildcard strip so the input and the endpoint cannot disagree about what counts.
export const GET: RequestHandler = async ({ url }) => {
	const q = authorSearchTerm(url.searchParams.get('q'));
	// The same empty answer for "too short" and "no matches" — there is nothing to distinguish, and
	// a distinct error status would only invite the caller to retry a query that cannot be served.
	if (!q) return json({ authors: [] });

	try {
		const authors = await getSanityClient().fetch(authorSuggestionsQuery, { q });
		// Public, identical for every visitor, and the taxonomy of who has published changes on the
		// scale of weeks — so a debounced type-ahead should not spend a Sanity round trip per
		// keystroke across all visitors. Same reasoning as the siteSettings TTL cache (DAR-73), and
		// safe for the same reason: nothing here is per-user.
		return json({ authors }, { headers: { 'cache-control': 'public, max-age=300' } });
	} catch (err) {
		// Same posture as the list loads: a Sanity outage degrades the type-ahead to "no suggestions"
		// (the visitor can still type a name and submit — the filter itself is server-side) rather
		// than surfacing a 500 into a filter bar.
		console.warn('[sanity] author suggestions fetch failed:', err);
		return json({ authors: [] });
	}
};
