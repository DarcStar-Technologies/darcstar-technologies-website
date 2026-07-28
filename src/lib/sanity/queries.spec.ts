import { describe, expect, it } from 'vitest';
import {
	AUTHOR_SUGGESTION_LIMIT,
	authorSuggestionsQuery,
	postsPageQuery,
	postBySlugQuery,
	papersPageByDateQuery,
	papersPageByDateAscQuery,
	papersPageByTitleQuery,
	paperBySlugQuery,
	peopleQuery,
	siteSettingsQuery,
	sitemapEntriesQuery
} from './queries';

// `defineQuery(str)` returns the GROQ string verbatim (with a phantom result type for TypeGen), so
// these assert the load-bearing bits of each query survive edits: the right `_type`, the ordering,
// the slug flattening, the reference derefs, and the person `internal`-only filter. TypeGen already
// proves the projections type-check; this guards the query SEMANTICS a type can't (filter/order/param).

/**
 * How many times a pattern appears in a query.
 *
 * Counting, rather than `toContain`, is what the sort-key and folded-name invariants below are
 * built on: both are of the form "every use of X is accounted for", which a containment check
 * cannot express — it passes as soon as ONE use is right, however many others are wrong.
 */
const occurrences = (query: string, pattern: RegExp) => query.match(pattern)?.length ?? 0;

describe('sanity GROQ queries', () => {
	it('postsPageQuery selects one page of published posts newest-first with dereferenced authors', () => {
		expect(postsPageQuery).toContain('_type == "post"');
		expect(postsPageQuery).toContain('order(publishedAt desc)');
		expect(postsPageQuery).toContain('"slug": slug.current');
		expect(postsPageQuery).toContain('authors[]->');
		// DAR-94: bounded, and the count is what the pager's page count is computed from.
		expect(postsPageQuery).toContain('[$offset...$end]');
		expect(postsPageQuery).toContain('"total": count(*[_type == "post" && defined(slug.current)])');
		// `featured` is authored in the Studio but no surface has ever rendered it — it was pure
		// payload. Pinned so it isn't re-added by reflex when someone copies the detail projection.
		// Word-anchored: a future `featuredImage` field is a different thing and must not trip this.
		expect(postsPageQuery).not.toMatch(/\bfeatured\b/);
	});

	it('postBySlugQuery is slug-parameterised and pulls the body + related papers', () => {
		expect(postBySlugQuery).toContain('slug.current == $slug');
		expect(postBySlugQuery).toContain('body');
		expect(postBySlugQuery).toContain('relatedPapers[]->');
		// DAR-55: related papers carry the origin flag (+ hasCommentary) so a third-party paper
		// referenced by a DarcStar post renders the "Third-party" chip, same as /research — the
		// projection must fetch darcstarAuthored, and hasCommentary stays a boolean when absent.
		expect(postBySlugQuery).toContain('darcstarAuthored');
		expect(postBySlugQuery).toContain('"hasCommentary": coalesce(count(commentary) > 0, false)');
	});

	it('the paper page queries carry the origin + annotation flags', () => {
		expect(papersPageByDateQuery).toContain('_type == "paper"');
		// DAR-52: the /research split renders darcstarAuthored, and hasCommentary must be a
		// boolean even when the field is absent (count(missing) is null → coalesce).
		expect(papersPageByDateQuery).toContain('darcstarAuthored');
		expect(papersPageByDateQuery).toContain(
			'"hasCommentary": coalesce(count(commentary) > 0, false)'
		);
	});

	it('paperBySlugQuery is slug-parameterised and pulls the PDF URL + commentary', () => {
		expect(paperBySlugQuery).toContain('slug.current == $slug');
		expect(paperBySlugQuery).toContain('"pdfUrl": pdf.asset->url');
		expect(paperBySlugQuery).toContain('darcstarAuthored');
		expect(paperBySlugQuery).toContain('commentary');
		// Full projection pinned: `description` feeds the topic tooltip on the detail page.
		expect(paperBySlugQuery).toContain(
			'"topics": array::compact(topics[]->{ _id, title, "slug": slug.current, description })'
		);
	});

	it('peopleQuery selects the team (non-external persons), name-sorted', () => {
		expect(peopleQuery).toContain('_type == "person"');
		// `!= "external"` (not `== "internal"`) so an unset `kind` still counts as team.
		expect(peopleQuery).toContain('kind != "external"');
		expect(peopleQuery).toContain('order(coalesce(nameSortKey, lower(name)) asc)');
	});

	// DAR-71: both detail queries must keep selecting `seo` — it carries metaTitle/metaDescription/
	// ogImage AND the "hide from search engines" flag, and contentSeo() has nothing to read without
	// it. Word-anchored, so a projection that merely mentions the string (`"seoTitle": …`) can't
	// satisfy this the way a bare `toContain('seo')` would.
	it.each([
		['postBySlugQuery', postBySlugQuery],
		['paperBySlugQuery', paperBySlugQuery]
	])('%s selects the seo object that drives the page head', (_name, query) => {
		expect(query).toMatch(/\bseo\b/);
	});

	// DAR-73: the singleton is projected down to the ONE field the site consumes. The narrowness is
	// the guard, not an optimisation — the other nine fields are inert, several are stale, and
	// `contactEmail` is the Resend From: address. Widening this to a bare `siteSettings` select would
	// ship all of it into `page.data` on every page, where it would look consumed. The floor keeps a
	// broken query from being visible, so nothing else would fail.
	it('siteSettingsQuery reads the singleton and selects ONLY socialLinks', () => {
		expect(siteSettingsQuery).toContain('_id == "siteSettings"');
		expect(siteSettingsQuery).toContain('socialLinks[]{ label, url }');
		for (const inert of [
			'primaryNav',
			'titleTemplate',
			'defaultOgImage',
			'contactEmail',
			'favicon'
		]) {
			expect(siteSettingsQuery, `${inert} is inert — see docs/sanity.md`).not.toContain(inert);
		}
	});
});

// DAR-71: the sitemap is the second surface the "hide from search engines" toggle has to reach —
// a hidden page must not be ADVERTISED to crawlers, not merely carry a robots meta. This pins the
// filter's polarity, which is the whole bug: `!= true` includes null, and no document sets `seo`
// today, so `== false` would silently empty the sitemap of every post and paper on the site.
describe('sitemapEntriesQuery honors seo.noIndex', () => {
	it.each([
		['posts', 'post'],
		['papers', 'paper']
	])('excludes hidden %s without excluding unflagged ones', (_key, type) => {
		expect(sitemapEntriesQuery).toContain(
			`*[_type == "${type}" && defined(slug.current) && seo.noIndex != true]`
		);
	});

	it('never uses the fail-closed comparison', () => {
		expect(sitemapEntriesQuery).not.toContain('== false');
	});
});

// ── DAR-94: the paginated /research query ─────────────────────────────────────────────────────
//
// Three literals exist because GROQ's `order()` cannot be parameterised, and TypeGen + the
// `client.fetch` overload only stay honest for a query built by CONST INTERPOLATION (a
// query-BUILDING function still generates a correct type but degrades the fetch result to `any` —
// measured). So the projection is duplicated three ways on purpose, and these tests are what make
// that duplication safe to live with.
describe('the /research page queries differ ONLY in their sort order', () => {
	const PAPER_PAGE_QUERIES = {
		date: papersPageByDateQuery,
		'date-asc': papersPageByDateAscQuery,
		title: papersPageByTitleQuery
	};
	// Everything from `| order(` to the slice is the intended difference; the rest must match.
	const withoutOrder = (query: string) =>
		query.replace(/\| order\(.*\) \[\$offset\.\.\.\$end\]/, '| order(…) [$offset...$end]');

	// The guard the duplication rests on. Types cannot see this: the three `…Result` types stay
	// structurally identical even if someone edits a FILTER predicate in one and not the others, so
	// `?sort=title` would quietly answer a different question than `?sort=date`.
	it('are byte-identical once the order clause is stripped', () => {
		const [reference, ...rest] = Object.values(PAPER_PAGE_QUERIES).map(withoutOrder);
		for (const query of rest) expect(query).toBe(reference);
	});

	// ...and the stripper must actually be removing something, or the test above passes vacuously
	// against three identical (i.e. broken) queries.
	it('really do carry three different order clauses', () => {
		const orders = Object.values(PAPER_PAGE_QUERIES).map((q) => /\| order\((.*)\) \[/.exec(q)?.[1]);
		expect(orders.every(Boolean)).toBe(true);
		expect(new Set(orders).size).toBe(3);
	});

	// Origin is the MAJOR key on both date sorts, which is what keeps the DAR-52 section split
	// truthful under pagination: the un-paginated page partitioned a date-sorted list at render
	// time, so first-party cards came first. Without this a page could interleave the two origins
	// and the section headings would be describing a subset of what is under them.
	it.each([
		['date', papersPageByDateQuery],
		['date-asc', papersPageByDateAscQuery]
	])('%s sorts origin-major so a page cannot straddle the section split', (_name, query) => {
		expect(query).toContain('order(select(darcstarAuthored == true => 0, 1) asc,');
	});

	// The title sort deliberately does NOT: it merges the sections into one A–Z list, as the page
	// already did, because two separately-sorted sections read as broken.
	it('title sorts merged, not origin-major', () => {
		expect(papersPageByTitleQuery).toContain('| order(coalesce(titleSortKey, lower(title)) asc)');
		expect(papersPageByTitleQuery).not.toContain('order(select(darcstarAuthored');
	});

	// The JS sort put undated papers LAST explicitly ("a plain reverse would surface them first").
	// A sentinel rather than `defined(publishedDate) desc` because GROQ's null placement in order()
	// is not something the corpus can exercise — every paper is dated — and this doesn't depend on it.
	it('date-asc keeps undated papers last', () => {
		expect(papersPageByDateAscQuery).toContain('coalesce(publishedDate, "9999-12-31") asc');
	});

	it.each(Object.entries(PAPER_PAGE_QUERIES))('%s is sliced to one page', (_name, query) => {
		expect(query).toContain('[$offset...$end]');
	});

	// "Showing 1–20 of 137" is only true if `total` counts the same set the rows come from. They are
	// the same interpolated const in the source, so this pins that they stay so.
	it.each(Object.entries(PAPER_PAGE_QUERIES))(
		'%s counts exactly the set it pages through',
		(_name, query) => {
			const rows = /\*\[(_type == "paper".*?)\] \| order/s.exec(query)?.[1];
			const counted = /"total": count\(\*\[(_type == "paper".*?)\]\)/s.exec(query)?.[1];
			expect(rows).toBeTruthy();
			expect(counted).toBe(rows);
		}
	);

	// DAR-52's fail-safe polarity, now living in GROQ as well as in `isDarcstarAuthored`. `!= true`
	// includes null, so an unset flag stays third-party; `== false` would silently drop every paper
	// whose author never touched the toggle — the identical trap DAR-71 hit in the sitemap.
	it.each(Object.entries(PAPER_PAGE_QUERIES))(
		'%s treats an unset origin flag as third-party',
		(_name, query) => {
			expect(query).toContain('($origin == "external" && darcstarAuthored != true)');
			expect(query).not.toContain('== false');
		}
	);

	// A null param must be a no-op, or an unfiltered index would return nothing.
	it.each(Object.entries(PAPER_PAGE_QUERIES))(
		'%s treats every unset filter as "no filter"',
		(_name, query) => {
			for (const param of ['$topic == null', '$author == null', '$origin == null']) {
				expect(query).toContain(param);
			}
		}
	);

	// The author filter accepts a slug OR a typed name — the control is a text input, so both have
	// to resolve, and existing `?author=<slug>` links must keep working. The third arm is DAR-104's:
	// `match` compares code points, so without it `?author=luk` misses `Łukasz Kaiser` and
	// `?author=re` misses `Christopher Ré`.
	it('resolves the author filter by slug, by name, or by folded name', () => {
		expect(papersPageByDateQuery).toContain('$author in authors[]->slug.current');
		expect(papersPageByDateQuery).toContain('authors[]->name match ($author + "*")');
		expect(papersPageByDateQuery).toContain('authors[]->nameSortKey match ($author + "*")');
	});

	// The facet half — the reason pagination needed more than a slice. Derived from the taxonomy,
	// not from the fetched papers, so the Topic select and the DAR-56 topic guide keep describing
	// the whole index rather than whichever 20 papers the visitor is looking at.
	it('sources the topic vocabulary from the taxonomy, in use only, with descriptions', () => {
		expect(papersPageByDateQuery).toContain('"topics": *[_type == "topic"');
		expect(papersPageByDateQuery).toContain(
			'count(*[_type == "paper" && defined(slug.current) && references(^._id)]) > 0'
		);
		expect(papersPageByDateQuery).toContain('description');
	});

	// ...and NOT from the papers. A topic description reached the page once per tag occurrence (15
	// copies of one string) purely to fill a `title` tooltip; it is rendered properly by TopicGuide
	// now, from the facet above. Re-adding it here is a payload regression that nothing else fails on.
	it('does not repeat topic descriptions on every paper', () => {
		expect(papersPageByDateQuery).toContain(
			'"topics": array::compact(topics[]->{ _id, title, "slug": slug.current })'
		);
	});

	// The list card clamps the abstract to 3 lines in CSS; shipping the whole thing to clip it was
	// 47% of this query's payload.
	it('binds the CARD field to the truncation, not merely to a truncation somewhere', () => {
		// Anchored on the key. An earlier version of this test asserted only that the expression
		// appeared somewhere in the query, and a mutation that bound `"abstract": abstract` and
		// parked the truncation under an unused key SURVIVED it — the payload back to full size with
		// every test still green.
		expect(papersPageByDateQuery).toContain(
			'"abstract": select(count(string::split(abstract, " ")) > 50 => array::join(string::split(abstract, " ")[0...50], " ")'
		);
		// ...and the raw field is never projected alongside it under any name.
		expect(papersPageByDateQuery).not.toMatch(/"abstract":\s*abstract\b/);
	});

	// The marker covers the one case measurement can't: an abstract of unusually short words that
	// fits inside the 3-line clamp, where the cut would otherwise render as a sentence stopping dead.
	// It must be conditional — an unconditional "…" would claim every short abstract was abridged.
	it('marks a truncated abstract, and only a truncated one', () => {
		expect(papersPageByDateQuery).toContain('count(string::split(abstract, " ")) > 50 =>');
		expect(papersPageByDateQuery).toContain('" ") + "…", abstract)');
	});

	// The detail page is the one surface with no topic guide and no clamp, so it keeps both in full.
	// This is the pairing that makes the two omissions above deliberate rather than a loss.
	it('leaves the detail page projection whole', () => {
		expect(paperBySlugQuery).toContain('abstract,');
		expect(paperBySlugQuery).toContain(
			'"topics": array::compact(topics[]->{ _id, title, "slug": slug.current, description })'
		);
	});

	// The author <datalist> seed. Bounded by the team rather than the corpus — the full vocabulary
	// grows ~7 people per paper forever (123 for 18 papers) — and `!= "external"` mirrors
	// peopleQuery's fail-open polarity, so an unset kind still counts as team.
	it('seeds the author control from the team, not the corpus', () => {
		expect(papersPageByDateQuery).toContain(
			'"teamAuthors": *[_type == "person" && kind != "external"'
		);
	});

	// Resolving `?author=tri-dao` back to "Tri Dao" for the input must key on the SLUG ONLY. Reusing
	// the filter's `match` here would label the box with one person while the results legitimately
	// contained several — e.g. `?author=da`.
	it('resolves the author label by exact slug, never by the name match', () => {
		expect(papersPageByDateQuery).toContain(
			'"authorLabel": *[_type == "person" && defined(slug.current) && slug.current == $author][0].name'
		);
	});
});

describe('authorSuggestionsQuery', () => {
	it('offers only people who have published, team first', () => {
		expect(authorSuggestionsQuery).toContain('_type == "person"');
		expect(authorSuggestionsQuery).toContain(
			'count(*[_type == "paper" && defined(slug.current) && references(^._id)]) > 0'
		);
		expect(authorSuggestionsQuery).toContain(
			'order(select(kind != "external" => 0, 1) asc, coalesce(nameSortKey, lower(name)) asc)'
		);
	});

	it('matches on a name prefix, accented or not', () => {
		expect(authorSuggestionsQuery).toContain('name match ($q + "*")');
		expect(authorSuggestionsQuery).toContain('nameSortKey match ($q + "*")');
	});

	// A lookup, not a way to page through the vocabulary — the cap is the second half of the
	// endpoint's length floor. Without both, `?q=` returns all 123 people (measured).
	it('caps one response', () => {
		expect(authorSuggestionsQuery).toContain(`[0...${AUTHOR_SUGGESTION_LIMIT}]`);
		expect(AUTHOR_SUGGESTION_LIMIT).toBeLessThanOrEqual(25);
	});
});

// A sort key (DAR-95) is a STORED, normalized copy of a title/name that the Studio's promote script
// derives on the way to `production`. It has to be stored because GROQ orders by code point and
// cannot normalize a string at query time — its `string::` namespace has only `startsWith` and
// `split`, and custom GROQ functions are projection-shaped. These pin the parts of that design that
// are invisible in the query source.
describe('sort keys never order without their fallback (DAR-95)', () => {
	const SORT_KEYED = {
		papersPageByDate: papersPageByDateQuery,
		papersPageByDateAsc: papersPageByDateAscQuery,
		papersPageByTitle: papersPageByTitleQuery,
		authorSuggestions: authorSuggestionsQuery,
		people: peopleQuery
	};

	// The load-bearing one, and the reason it counts rather than just looking for a `coalesce`
	// somewhere: `order(titleSortKey asc)` would type-check, satisfy every other assertion in this
	// file, and silently break the index for every document that has no key — which is ALL of them
	// until `pnpm promote` runs in the Studio, and any of them written past promote afterwards. The
	// property is therefore that EVERY mention of a key sits inside its coalesce, not that one does.
	//
	// It also pins the fallback's shape: `coalesce(titleSortKey, title)` fails here, because an
	// un-keyed paper has to land exactly where it did before DAR-95 — which was case-insensitive, so
	// dropping the `lower()` would regress "eDiffi" back to sorting after "Efficient".
	//
	// DAR-104 gave a key a SECOND legitimate use — matching, not just ordering — and DAR-105 a THIRD:
	// projecting it to the client, which folds it into the datalist option's `label` so the browser's
	// own accent-sensitive filter stops hiding the row the `match` arm just found. Each time the right
	// side grew a term rather than the assertion being relaxed. The distinction between the three is
	// real: a bare `order(nameSortKey asc)` still fails, because ordering is where a missing key
	// silently mis-places a document, while a `match` arm that finds nothing is one of two arms that
	// did not fire, and an un-projected `key` arrives as `null` and simply emits no label. Enumerating
	// them is what keeps "a key appeared somewhere new" a decision rather than an accident.
	it.each(Object.entries(SORT_KEYED))(
		'%s mentions no sort key outside its coalesce, its match arm or its projection',
		(_name, query) => {
			expect(occurrences(query, /titleSortKey/g)).toBe(
				occurrences(query, /coalesce\(titleSortKey, lower\(title\)\)/g)
			);
			expect(occurrences(query, /nameSortKey/g)).toBe(
				occurrences(query, /coalesce\(nameSortKey, lower\(name\)\)/g) +
					occurrences(query, /nameSortKey match \(\$\w+ \+ "\*"\)/g) +
					occurrences(query, /"key": nameSortKey/g)
			);
		}
	);

	// ...and the counting above is 0 === 0 for any query that stopped using a key at all, so this is
	// what stops the whole block passing vacuously against a revert.
	it('really does key every string ordering that has one', () => {
		expect(papersPageByTitleQuery).toContain('titleSortKey');
		expect(papersPageByDateQuery).toContain('nameSortKey'); // the teamAuthors facet seed
		expect(authorSuggestionsQuery).toContain('nameSortKey');
		expect(peopleQuery).toContain('nameSortKey');
	});

	// One expression, three call sites. They order the same vocabulary from different pages, so a
	// per-site copy is exactly the kind of thing that drifts — and the type system cannot see it,
	// since all three are just strings.
	it('orders every by-name list through the one expression', () => {
		const byName = 'coalesce(nameSortKey, lower(name)) asc';
		expect(papersPageByDateQuery).toContain(`| order(${byName})`);
		expect(peopleQuery).toContain(`| order(${byName})`);
		// The suggestion endpoint keeps team members first, so its name key is the MINOR one.
		expect(authorSuggestionsQuery).toContain(`asc, ${byName})`);
	});

	// The one string ordering deliberately left un-keyed: a bounded ten-term taxonomy, all ASCII,
	// rendered in a <select> that is scanned rather than searched. Asserted so that "topics were
	// forgotten" and "topics were considered and skipped" are distinguishable a year from now.
	it('leaves the topic facet ordering alone', () => {
		expect(papersPageByDateQuery).toContain('| order(title asc)');
	});
});

// GROQ's `match` compares code points, so matching a person by typed text is accent-SENSITIVE:
// measured against production, `luk` found nothing while `Łukasz Kaiser` sat in the index, and the
// same held for `re`/`Christopher Ré` and `konighofer`/`Bettina Könighofer`. Every accented author
// in the corpus was unreachable by the spelling an English keyboard produces. The fix reuses
// DAR-95's stored fold, so the same key now answers "where does this sort?" and "did they mean
// this person?".
describe('a name is never matched without its folded key (DAR-104)', () => {
	// Deliberately NOT the same table as SORT_KEYED above: this one is "queries that match a person
	// by typed text", which excludes `peopleQuery` — /people is a listing, not a search, so it orders
	// by the key without ever matching on it. Adding it here would make the vacuity guard below fail
	// for the right reason and the wrong test.
	const NAME_MATCHERS = {
		papersPageByDate: papersPageByDateQuery,
		papersPageByDateAsc: papersPageByDateAscQuery,
		papersPageByTitle: papersPageByTitleQuery,
		authorSuggestions: authorSuggestionsQuery
	};

	// The invariant, counted rather than spot-checked, for the reason DAR-95 counts: the two call
	// sites CANNOT share one expression. `defineQuery` has to receive a const-interpolated template
	// or TypeScript widens the argument to `string`, `overloadClientMethods` stops resolving, and
	// `client.fetch()` silently returns `any` (DAR-94 proved this) — so a shared builder function is
	// exactly the refactor that must not happen here, and the arms are written twice on purpose.
	// Counting is what makes "someone widened one and not the other" a failure instead of a subtle
	// difference between the type-ahead and the filter it feeds.
	//
	it.each(Object.entries(NAME_MATCHERS))('%s pairs every name match with a folded one', (_n, q) => {
		expect(occurrences(q, /nameSortKey match /g)).toBe(occurrences(q, /name match /g));
	});

	// The pairing above is only meaningful if the two patterns are DISJOINT, which is a property of
	// the field names rather than of the queries — so it is proven here instead of asserted in a
	// comment. Were `/name match /` to also match `nameSortKey match `, the invariant would read
	// `n === 2n` and could hold only when both sides were zero: a test that fails on every correct
	// query and passes on a total revert. Exactly inverted, and silent.
	it('counts the plain and folded patterns disjointly', () => {
		expect(occurrences('nameSortKey match ', /name match /g)).toBe(0);
		expect(occurrences('authors[]->nameSortKey match ', /name match /g)).toBe(0);
		expect(occurrences('name match ', /name match /g)).toBe(1);
	});

	// ...and 0 === 0 satisfies the above, so this is what stops a revert passing vacuously. Every
	// query in the table, not a representative two: the three paper queries share `PAPER_MATCH`
	// today, but that is the thing under test, not something to assume while testing it.
	it.each(Object.entries(NAME_MATCHERS))('%s really does match names at all', (_n, q) => {
		expect(occurrences(q, /name match /g)).toBeGreaterThan(0);
	});

	// The suggestion arms must be OR'd inside one group. Dropping the parentheses would `&&` the
	// published-papers filter against only the second arm, quietly changing which people the
	// endpoint offers — a precedence bug no type can see and the counting above would not catch.
	it('groups the two suggestion arms so the published filter applies to both', () => {
		expect(authorSuggestionsQuery).toContain(
			'(name match ($q + "*") || nameSortKey match ($q + "*")) && count('
		);
	});

	// The folded key is a `production` artifact — `dev` carries none — so this arm has to be
	// additive. It is OR'd, never substituted for the plain `name` match, which is what makes a
	// key-less dataset degrade to exactly the pre-DAR-104 behaviour instead of matching nothing.
	it('adds the folded arm rather than replacing the plain one', () => {
		expect(papersPageByDateQuery).toContain(
			'authors[]->name match ($author + "*") || authors[]->nameSortKey match ($author + "*")'
		);
	});
});

// DAR-104 stopped at the endpoint, and the browser undid it: a native <datalist> filters the options
// it is handed by a case-insensitive SUBSTRING test over code points, so the row `?q=luk` had just
// found was dropped before the visitor saw it (measured in headed chromium and firefox, both
// controls holding). The client fixes that by folding `key` into each option's `label`, which means
// every query that feeds those options has to project it.
describe('every author option carries the folded key that makes it findable (DAR-105)', () => {
	// Both option sources, not one: `teamAuthors` seeds the datalist until the visitor reaches the
	// 3-character floor, so the seed is what the browser filters for the first two keystrokes. The
	// suggestion query takes over after that. A fix applied to only one of them would work for
	// exactly the queries that happened to be long enough.
	const OPTION_SOURCES = {
		papersPageByDate: papersPageByDateQuery,
		papersPageByDateAsc: papersPageByDateAscQuery,
		papersPageByTitle: papersPageByTitleQuery,
		authorSuggestions: authorSuggestionsQuery
	};

	// Counted against the label projection rather than asserted as "contains a key somewhere", for
	// the DAR-95 reason: a new person projection added later — a co-author facet, an /people search —
	// would carry a label and no key, and the datalist would hide its accented names again with every
	// existing assertion still green. Tying the count to `"label": name` makes the two grow together.
	it.each(Object.entries(OPTION_SOURCES))('%s pairs every option label with a key', (_n, q) => {
		expect(occurrences(q, /"key": nameSortKey/g)).toBe(occurrences(q, /"label": name\b/g));
	});

	// ...and 0 === 0 above, so this is the vacuity guard: dropping both projections must fail.
	it.each(Object.entries(OPTION_SOURCES))('%s really does project author options', (_n, q) => {
		expect(occurrences(q, /"label": name\b/g)).toBeGreaterThan(0);
	});

	// The pairing is only meaningful if the two patterns are disjoint on the FIELD NAMES, the same
	// trap DAR-104 proved for its match arms: without the word boundary, `"label": name` would also
	// count a hypothetical `"label": nameSortKey`, and the invariant could hold while every option
	// shipped the folded string as its display name.
	it('does not count a folded projection as a plain one', () => {
		expect(occurrences('"label": nameSortKey', /"label": name\b/g)).toBe(0);
		expect(occurrences('"label": name,', /"label": name\b/g)).toBe(1);
	});
});
