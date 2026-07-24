import { defineQuery } from 'groq';

// The canonical GROQ query library. EVERY query is a `defineQuery(...)` string literal so Sanity
// TypeGen can statically find it (scanning `./src/**/*.{ts,tsx}` per sanity.cli.ts) and emit a
// `<Name>Result` type into src/lib/sanity/types.ts. With `overloadClientMethods`, passing one of
// these to `sanityClient.fetch(q)` returns that generated type — no hand-written result interfaces.
//
// Projection rules that keep the whole pipeline typed AND correct:
//   • Flatten `slug.current` → `"slug"` so callers use `post.slug`, never `post.slug.current`.
//   • Deref references (`authors[]->`, `categories[]->`, `relatedPapers[]->`) to the fields we render,
//     WRAPPED in `array::compact(...)`: a reference whose target has no PUBLISHED version (or was
//     deleted / is a weak ref) dereferences to `null` and GROQ leaves that null in the array — TypeGen
//     types the elements as non-null, so an unguarded `.map(a => a.name)` / `{#each … (x._id)}` would
//     crash the whole page. `array::compact` drops the nulls at the source, keeping data + types honest.
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
		"authors": array::compact(authors[]->{ _id, name, "slug": slug.current, role })
	}
`);

export const postBySlugQuery = defineQuery(`
	*[_type == "post" && slug.current == $slug][0] {
		_id,
		_updatedAt,
		title,
		"slug": slug.current,
		excerpt,
		publishedAt,
		coverImage,
		body,
		"authors": array::compact(authors[]->{ _id, name, "slug": slug.current, role, image }),
		"categories": array::compact(categories[]->{ _id, title, "slug": slug.current }),
		"relatedPapers": array::compact(relatedPapers[]->{ _id, title, "slug": slug.current, venue }),
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
		"hasCommentary": coalesce(count(commentary) > 0, false),
		venue,
		publishedDate,
		url,
		doi,
		arxivId,
		codeUrl,
		abstract,
		"authors": array::compact(authors[]->{ _id, name, "slug": slug.current }),
		"topics": array::compact(topics[]->{ _id, title, description })
	}
`);

export const paperBySlugQuery = defineQuery(`
	*[_type == "paper" && slug.current == $slug][0] {
		_id,
		_updatedAt,
		title,
		"slug": slug.current,
		status,
		darcstarAuthored,
		abstract,
		commentary,
		venue,
		publishedDate,
		url,
		doi,
		arxivId,
		codeUrl,
		"pdfUrl": pdf.asset->url,
		"authors": array::compact(authors[]->{ _id, name, "slug": slug.current, role }),
		"topics": array::compact(topics[]->{ _id, title, description }),
		"categories": array::compact(categories[]->{ _id, title, "slug": slug.current }),
		seo
	}
`);

// Everything /sitemap.xml needs in ONE round trip: routable slugs + `_updatedAt` (the sitemap
// <lastmod>) for both content types. Deliberately minimal — the endpoint runs on every crawler
// fetch, so it shouldn't pay for bodies/authors/images it never renders.
export const sitemapEntriesQuery = defineQuery(`{
	"posts": *[_type == "post" && defined(slug.current)]{ "slug": slug.current, _updatedAt },
	"papers": *[_type == "paper" && defined(slug.current)]{ "slug": slug.current, _updatedAt }
}`);

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
