import { defineQuery } from 'groq';

// The canonical GROQ query library. EVERY query is a `defineQuery(...)` string literal so Sanity
// TypeGen can statically find it (scanning `./src/**/*.{ts,tsx}` per sanity.cli.ts) and emit a
// `<Name>Result` type into src/lib/sanity/types.ts. With `overloadClientMethods`, passing one of
// these to `sanityClient.fetch(q)` returns that generated type — no hand-written result interfaces.
//
// Projection rules that keep the whole pipeline typed AND correct:
//   • Flatten `slug.current` → `"slug"` so callers use `post.slug`, never `post.slug.current`.
//   • Deref references (`authors[]->`, `categories[]->`, `relatedPapers[]->`) to the fields we render.
//   • Leave image FIELDS (`coverImage`, `image`, body image blocks) un-dereferenced — `urlFor()`
//     needs the `asset._ref` intact to build sized CDN URLs (see image.ts).
//   • `defined(slug.current)` guards list rows that lack a routable slug.

export const postsQuery = defineQuery(`
	*[_type == "post" && defined(slug.current)] | order(publishedAt desc) {
		_id,
		title,
		"slug": slug.current,
		excerpt,
		publishedAt,
		featured,
		coverImage,
		authors[]->{ _id, name, "slug": slug.current, role }
	}
`);

export const postBySlugQuery = defineQuery(`
	*[_type == "post" && slug.current == $slug][0] {
		_id,
		title,
		"slug": slug.current,
		excerpt,
		publishedAt,
		coverImage,
		body,
		authors[]->{ _id, name, "slug": slug.current, role, image },
		categories[]->{ _id, title, "slug": slug.current },
		relatedPapers[]->{ _id, title, "slug": slug.current, venue },
		seo
	}
`);

export const papersQuery = defineQuery(`
	*[_type == "paper" && defined(slug.current)] | order(publishedDate desc) {
		_id,
		title,
		"slug": slug.current,
		status,
		darcstarAuthored,
		venue,
		publishedDate,
		url,
		doi,
		arxivId,
		codeUrl,
		abstract,
		authors[]->{ _id, name, "slug": slug.current }
	}
`);

export const paperBySlugQuery = defineQuery(`
	*[_type == "paper" && slug.current == $slug][0] {
		_id,
		title,
		"slug": slug.current,
		status,
		darcstarAuthored,
		abstract,
		venue,
		publishedDate,
		url,
		doi,
		arxivId,
		codeUrl,
		"pdfUrl": pdf.asset->url,
		authors[]->{ _id, name, "slug": slug.current, role },
		categories[]->{ _id, title, "slug": slug.current },
		seo
	}
`);

// Team = anyone NOT an external co-author. `kind != "external"` (rather than `== "internal"`) is
// deliberate: `kind` is only explicitly set to "external" for citation-only authors, so an unset/null
// kind (the schema's initialValue isn't applied to programmatic seeds) still counts as team. GROQ's
// `!=` includes null here, so a person with no `kind` shows on /people.
export const peopleQuery = defineQuery(`
	*[_type == "person" && kind != "external"] | order(name asc) {
		_id,
		name,
		"slug": slug.current,
		role,
		image,
		bio,
		socialLinks[]{ label, url }
	}
`);
