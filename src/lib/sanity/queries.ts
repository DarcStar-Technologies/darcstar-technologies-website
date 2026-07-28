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

// ── Paginated indexes (DAR-94) ────────────────────────────────────────────────────────────────
//
// Both list queries return ONE PAGE plus the totals (and, for papers, the facet vocabulary) in a
// SINGLE round trip, via a top-level object projection — the shape `sitemapEntriesQuery` already
// uses. They replace the `*[...]` fetch-everything queries these indexes used to run: those shipped
// every abstract, author and topic of every published document on every SSR request, so the page
// cost grew with the corpus rather than with what a visitor sees.
//
// Two rules make the paper queries safe to edit:
//
//   1. EVERY part that must not vary between the three sort variants is a shared `const`
//      interpolated into all of them, so the only textual difference is the `order()` clause
//      (pinned by queries.spec.ts, which strips that clause and compares the rest byte-for-byte).
//   2. `defineQuery` must receive a CONST-INTERPOLATED template, never a function call.
//      `defineQuery(build(order))` type-checks and TypeGen even emits a correct `…Result` for it,
//      but TS infers the argument as plain `string`, so `overloadClientMethods` fails to resolve
//      and `client.fetch()` silently returns `any` (measured: a probe asserting `const s: string =
//      result.total` errored for the const form and PASSED for the function form). Losing the
//      types is invisible until something reads a field that isn't there.
//
// A null filter param is a NO-OP (`$topic == null || …`), which is what lets one static literal
// carry every filter combination while staying statically typed.

const PAGE_SLICE = `[$offset...$end]`;

// `defined(slug.current)` guards rows with no routable slug, exactly as the old queries did.
// Origin polarity is FAIL-SAFE and load-bearing: external is `darcstarAuthored != true`, never
// `== false`, so an unset flag stays third-party — the same trap DAR-71 hit in the sitemap, and the
// GROQ half of the rule `isDarcstarAuthored` carries in TS ($lib/research-filters.ts). Because it
// now lives in two languages, queries.spec.ts pins it.
//
// `$author` accepts EITHER a slug or a typed name: the filter bar's author control is a text input
// (the vocabulary is too large to ship — see the facets below), so `?author=dao` must work, while
// `?author=tri-dao` links that already exist must keep working. `match` is case-insensitive and
// token-prefixed (measured: "DAO" and "dao*" both hit, "ao*" does not).
//
// It is NOT accent-insensitive, though, and that is what the `nameSortKey` arm buys (DAR-104):
// `match` compares code points, so `luk` did not find `Łukasz Kaiser` and `re` did not find
// `Christopher Ré` — every accented author in the corpus was unreachable by the spelling an
// English-keyboard visitor types, with no signal that the query was the problem. DAR-95 already
// stores the folded form for `order()`; matching it too is that key answering the same question.
// Measured against production, the arm adds exactly those three authors and moves nothing else
// (`dao` 4, `da` 8, `gu` 2, `tri-dao` 4 — all unchanged), and it does NOT resurrect DAR-100's
// retired `?author=ukasz-kaiser`, which stays at 0.
//
// FAIL-SAFE, like the origin polarity above: a sort key is a `production` artifact, so a person
// without one just fails this arm and the predicate degrades to exactly the old behaviour rather
// than erroring (measured against `dev`, where no document has the key).
const PAPER_MATCH = `_type == "paper" && defined(slug.current)
		&& ($topic == null || $topic in topics[]->slug.current)
		&& ($author == null || $author in authors[]->slug.current || authors[]->name match ($author + "*") || authors[]->nameSortKey match ($author + "*"))
		&& ($origin == null
			|| ($origin == "darcstar" && darcstarAuthored == true)
			|| ($origin == "external" && darcstarAuthored != true))`;

// The list card's fields. Two deliberate omissions versus the detail query:
//
//   • `abstract` is TRUNCATED to 50 words, which were 47% of this query's payload. The card clamps
//     it to 3 lines in CSS anyway, and measured in a real browser at 390/768/1440 px every
//     truncated abstract still overflows that clamp — so what a visitor sees is unchanged, and the
//     ellipsis they see is the CSS one.
//
//     The `+ "…"` is for the case that measurement CANNOT rule out: a 50-word abstract of unusually
//     short words could fit inside 3 lines, and then the cut would render as a sentence stopping
//     dead with no indication why. Marking the truncation in the DATA makes it self-evident at any
//     width instead of resting on an assumption about the corpus. It never doubles up — when the
//     clamp does fire, CSS ellipsises at line 3 and our marker is past it, unrendered.
//
//     Deliberately NOT gated on `defined(abstract)`: measured on production, that predicate answers
//     6 in a FILTER while all 18 papers have an abstract in a PROJECTION (Sanity's filter index
//     disagreeing with the documents). `select()` falls through to the raw field, so a missing
//     abstract stays null — which the card's `{#if}` already guards.
//   • topic `description` is GONE. It reached the page once per tag occurrence (15 copies of the
//     same string, ~3.0 KB against 989 bytes distinct) to feed a `title` tooltip. The descriptions
//     now arrive ONCE in the topic facet below, which is what TopicGuide renders (DAR-56). The
//     detail query still projects it — there is no topic guide there, so the tooltip is that page's
//     only surface for it.
const PAPER_CARD = `
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
			"abstract": select(count(string::split(abstract, " ")) > 50 => array::join(string::split(abstract, " ")[0...50], " ") + "…", abstract),
			"authors": array::compact(authors[]->{ _id, name, "slug": slug.current }),
			"topics": array::compact(topics[]->{ _id, title, "slug": slug.current })`;

// Every by-name ordering on the site — the facet seed below, the author type-ahead, /people — goes
// through ONE expression so they cannot drift apart, and it carries DAR-95's stored sort key with
// the same fallback `ORDER_TITLE` uses (see there for why the key has to be stored at all).
//
// This is the ordering the dataset can actually exercise TODAY, which is why DAR-95 covers people
// and not only papers: no paper title carries a diacritic, but `Łukasz Kaiser` sorted last of 123
// authors, after every Z, because `Ł` (U+0141) is above `Z` in code-point order. Two of the three
// call sites were not even `lower()`ed before this.
const ORDER_PERSON_NAME = `coalesce(nameSortKey, lower(name)) asc`;

// Everything the /research chrome needs that ISN'T the current page. This is the half that makes
// pagination possible at all: the facets used to be derived from the fetched papers, so slicing the
// fetch would have shrunk the Topic select and the topic guide to whatever happened to be on the
// visitor's page. Sourced from the taxonomy instead, they now describe the WHOLE in-use index —
// strictly more correct than before, not a compromise.
//
// `count(*[… references(^._id)]) > 0` keeps a term that no published paper uses out of the
// controls, matching the old "only offer values that match at least one paper" guarantee.
//
// `teamAuthors` seeds the author input's <datalist> so the control offers something before the
// visitor types, and it is bounded by the team rather than the corpus (the full author vocabulary
// is ~7 new people per paper and never plateaus — 123 for 18 papers, ~2,000 at 300). `kind !=
// "external"` mirrors peopleQuery's fail-open polarity: an unset kind counts as team. It carries
// `key` for the same reason `authorSuggestionsQuery` does (DAR-105): the seed is what the datalist
// filters until the visitor reaches the 3-character floor, so an accented teammate would be hidden
// there by exactly the browser rule that hid the co-authors. Every teammate is ASCII today, which
// is precisely why the symmetry has to be in the query rather than in someone remembering.
//
// `authorLabel` resolves the filter's slug back to a display name so `?author=tri-dao` shows "Tri
// Dao" in the box. It matches on the SLUG ONLY — never the `match` form the filter accepts —
// because a broad term like `?author=da` would otherwise label the control with one person while
// the results legitimately contained several.
const PAPER_PAGE_META = `
		"total": count(*[${PAPER_MATCH}]),
		"totalAll": count(*[_type == "paper" && defined(slug.current)]),
		"topics": *[_type == "topic" && defined(slug.current) && count(*[_type == "paper" && defined(slug.current) && references(^._id)]) > 0] | order(title asc) {
			"slug": slug.current,
			title,
			description
		},
		"teamAuthors": *[_type == "person" && kind != "external" && defined(slug.current) && count(*[_type == "paper" && defined(slug.current) && references(^._id)]) > 0] | order(${ORDER_PERSON_NAME}) {
			"value": slug.current,
			"label": name,
			"key": nameSortKey
		},
		"authorLabel": *[_type == "person" && defined(slug.current) && slug.current == $author][0].name`;

// The origin split (DAR-52) renders as two sections, and under pagination that framing is only
// honest if a page can't interleave them — so origin is the MAJOR sort key. This reproduces exactly
// what the un-paginated page rendered (it partitioned a date-sorted list at render time, so
// first-party cards came first), while guaranteeing each page's sections stay contiguous and in
// order. `== true` keeps the fail-safe polarity: unset sorts with the third-party work.
const ORIGIN_MAJOR = `select(darcstarAuthored == true => 0, 1) asc`;

// `coalesce(…, "9999-12-31")` keeps undated papers LAST, which is what the JS sort this replaces
// did explicitly ("a plain reverse would surface them first"). It is spelled with a sentinel rather
// than `defined(publishedDate) desc` because GROQ's null placement in `order()` is not something
// this dataset can exercise — every paper is dated — and a sentinel doesn't depend on knowing it.
// The default `date` order is left byte-identical to the old query's, so undated papers keep
// whatever position they have today.
const ORDER_DATE = `${ORIGIN_MAJOR}, publishedDate desc`;
const ORDER_DATE_ASC = `${ORIGIN_MAJOR}, coalesce(publishedDate, "9999-12-31") asc`;
// No origin key: a title sort MERGES the sections into one A–Z list (two separately-sorted sections
// read as broken), which is what the page already did for this sort.
//
// `lower()` rather than a bare `title`: GROQ orders strings by code point, so without it "eDiffi"
// would sort after "Efficient".
//
// `titleSortKey` (DAR-95) restores the other half — the accent-insensitivity `localeCompare(…,
// { sensitivity: 'base' })` had. It has to be a STORED field because GROQ cannot normalize a string
// at query time: the `string::` namespace has only `startsWith` and `split`, there is no replace or
// normalize, and custom GROQ functions are projection-shaped. The Studio's promote script derives it
// (lowercased, NFD-stripped, and Latin-folded for the stroke letters NFD leaves alone).
//
// KEEP THE `coalesce` FALLBACK. A document without a key sorts exactly as it did before, which is
// measured rather than assumed: against the current corpus — where no paper carries a key yet — this
// expression returns the 18 real titles byte-identically to `lower(title)`. That is what lets the
// two repos ship in either order and what makes an un-promoted document degrade instead of jumping
// to the front of the index under a null.
const ORDER_TITLE = `coalesce(titleSortKey, lower(title)) asc`;

export const papersPageByDateQuery = defineQuery(`{
		"papers": *[${PAPER_MATCH}] | order(${ORDER_DATE}) ${PAGE_SLICE} {${PAPER_CARD}
		},${PAPER_PAGE_META}
	}`);

export const papersPageByDateAscQuery = defineQuery(`{
		"papers": *[${PAPER_MATCH}] | order(${ORDER_DATE_ASC}) ${PAGE_SLICE} {${PAPER_CARD}
		},${PAPER_PAGE_META}
	}`);

export const papersPageByTitleQuery = defineQuery(`{
		"papers": *[${PAPER_MATCH}] | order(${ORDER_TITLE}) ${PAGE_SLICE} {${PAPER_CARD}
		},${PAPER_PAGE_META}
	}`);

/** Cap on one author-suggestion response — a lookup, never a way to page through the vocabulary. */
export const AUTHOR_SUGGESTION_LIMIT = 12;

// Backs the author input's type-ahead (GET /research/authors.json). Team members sort first, so the
// people this site is about lead the list however many co-authors match. The name ordering being
// correct matters more here than anywhere else on the site, because this list is CAPPED: a name
// that mis-sorts to the end is not merely in an odd place, it can fall off the response entirely.
//
// The caller enforces a minimum query length and strips `match` wildcards, and BOTH are
// load-bearing rather than defensive: measured, `q = ""` and `q = "*"` each match all 123 people,
// so without them this endpoint would hand out the whole vocabulary the page exists to avoid
// shipping. The `nameSortKey` arm does not weaken that — an empty term matches everything through
// it too, for the same reason.
//
// That arm is DAR-104's accent-blind half, and DAR-105 settled the question it left open: making
// the ENDPOINT answer `?q=luk` with `Łukasz Kaiser` was not enough, because `/research`'s control
// is a native `<datalist>` that applies its OWN matching to the options it is handed, and that
// matching is accent-sensitive in both engines measured. The row the server found was then hidden
// by the browser. `key` is what fixes it: the client folds it into each option's `label`
// attribute, which is the only string Firefox matches on. See `authorOptionLabel`
// ($lib/research-filters.ts) for the measurements and the per-engine rules.
//
// Projecting the STORED key rather than folding `name` in the browser is what lets the suggestion
// list AGREE with the filter instead of approximating it, and the agreement is structural in both
// directions. The server matches a token PREFIX of `name` or `nameSortKey`; the browser matches a
// SUBSTRING of the label when there is one and of the name when there is not. A label is emitted
// exactly when the name does not already contain the key, so either the label carries both strings
// whole or the name alone already covers both — and a token prefix is always a substring of its own
// string. No row this query returns can be one the datalist then hides.
//
// What held even while this was open: the datalist is progressive enhancement over a plain text
// field, and `PAPER_MATCH` carries the same arm — so typing `luk` and submitting returns the paper
// whether or not the dropdown offered it. See `PAPER_MATCH` for the measurements and the fail-safe
// polarity; the two arms must stay in step, which `queries.spec.ts` pins by counting them.
export const authorSuggestionsQuery = defineQuery(`
	*[_type == "person" && defined(slug.current) && (name match ($q + "*") || nameSortKey match ($q + "*")) && count(*[_type == "paper" && defined(slug.current) && references(^._id)]) > 0]
		| order(select(kind != "external" => 0, 1) asc, ${ORDER_PERSON_NAME}) [0...${AUTHOR_SUGGESTION_LIMIT}] {
			"value": slug.current,
			"label": name,
			"key": nameSortKey
		}
`);

// /news has no facets, so it is the same shape without the vocabulary half. `featured` is gone from
// the projection: the field is authored in the Studio but no surface has ever rendered it.
const POST_MATCH = `_type == "post" && defined(slug.current)`;

export const postsPageQuery = defineQuery(`{
		"posts": *[${POST_MATCH}] | order(publishedAt desc) ${PAGE_SLICE} {
			_id,
			title,
			"slug": slug.current,
			excerpt,
			publishedAt,
			coverImage,
			"authors": array::compact(authors[]->{ _id, name, "slug": slug.current, role })
		},
		"total": count(*[${POST_MATCH}])
	}`);

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
		"relatedPapers": array::compact(relatedPapers[]->{ _id, title, "slug": slug.current, venue, darcstarAuthored, "hasCommentary": coalesce(count(commentary) > 0, false) }),
		seo
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
		"topics": array::compact(topics[]->{ _id, title, "slug": slug.current, description }),
		"categories": array::compact(categories[]->{ _id, title, "slug": slug.current }),
		seo
	}
`);

// Everything /sitemap.xml needs in ONE round trip: routable slugs + `_updatedAt` (the sitemap
// <lastmod>) for both content types. Deliberately minimal — the endpoint runs on every crawler
// fetch, so it shouldn't pay for bodies/authors/images it never renders.
//
// `seo.noIndex != true` honors the Studio's "Hide from search engines" toggle (DAR-71): a hidden
// page must not be ADVERTISED to crawlers, not just carry a robots meta. Polarity is load-bearing —
// `!= true` (never `== false`) because GROQ's `!=` includes null, and no document today sets `seo`
// at all, so the inverse would empty the sitemap of every post and paper on the site. Same fail-open
// shape as `peopleQuery`'s `kind != "external"`; hiding requires a POSITIVE signal. The robots-meta
// half of this rule lives in content-seo.ts (`seo?.noIndex === true`) — keep the two in step.
export const sitemapEntriesQuery = defineQuery(`{
	"posts": *[_type == "post" && defined(slug.current) && seo.noIndex != true]{ "slug": slug.current, _updatedAt },
	"papers": *[_type == "paper" && defined(slug.current) && seo.noIndex != true]{ "slug": slug.current, _updatedAt }
}`);

// The `siteSettings` singleton, projected down to the ONE field the site consumes (DAR-73).
//
// The projection is deliberately narrow rather than a bare `siteSettings` select. The singleton is a
// five-tab editing surface in the Studio and the rest of it is inert — page titles come from Paraglide,
// the OG card from `scripts/gen-og.mjs`, the brand name/email from `$lib/site.ts`, and `primaryNav`
// points at routes that don't exist. Naming the one live field here means the read layer states what
// the CMS actually drives, and a field added in the Studio can't silently start shipping to the client.
// See docs/sanity.md — the trim of the inert fields is DAR-73's deferred half.
//
// `_id == "siteSettings"` is the fixed singleton id (the Studio pins it in structure.ts). In
// `production` it is also the ONE type readable WITHOUT a token — that dataset gates document reads,
// but siteSettings is public — so the deployed site resolves this even if the viewer token lapses.
// That is NOT true of `dev`, which is private end to end: a dev-pointed build with no token reads
// nothing here and falls back to the site constant (verified). Either way the caller never sees an
// error; see $lib/server/site-settings.ts.
export const siteSettingsQuery = defineQuery(`
	*[_id == "siteSettings"][0] {
		socialLinks[]{ label, url }
	}
`);

// Team = anyone NOT an external co-author. `kind != "external"` (rather than `== "internal"`) is
// deliberate: `kind` is only explicitly set to "external" for citation-only authors, so an unset/null
// kind (the schema's initialValue isn't applied to programmatic seeds) still counts as team. GROQ's
// `!=` includes null here, so a person with no `kind` shows on /people.
export const peopleQuery = defineQuery(`
	*[_type == "person" && kind != "external"] | order(${ORDER_PERSON_NAME}) {
		_id,
		name,
		"slug": slug.current,
		role,
		image,
		bio,
		socialLinks[]{ label, url }
	}
`);
