import { describe, expect, it } from 'vitest';
import {
	postsQuery,
	postBySlugQuery,
	papersQuery,
	paperBySlugQuery,
	peopleQuery,
	siteSettingsQuery,
	sitemapEntriesQuery
} from './queries';

// `defineQuery(str)` returns the GROQ string verbatim (with a phantom result type for TypeGen), so
// these assert the load-bearing bits of each query survive edits: the right `_type`, the ordering,
// the slug flattening, the reference derefs, and the person `internal`-only filter. TypeGen already
// proves the projections type-check; this guards the query SEMANTICS a type can't (filter/order/param).

describe('sanity GROQ queries', () => {
	it('postsQuery selects published posts newest-first with dereferenced authors', () => {
		expect(postsQuery).toContain('_type == "post"');
		expect(postsQuery).toContain('order(publishedAt desc)');
		expect(postsQuery).toContain('"slug": slug.current');
		expect(postsQuery).toContain('authors[]->');
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

	it('papersQuery selects published papers newest-first with the origin + annotation flags', () => {
		expect(papersQuery).toContain('_type == "paper"');
		expect(papersQuery).toContain('order(publishedDate desc)');
		// DAR-52: the /research split renders darcstarAuthored, and hasCommentary must be a
		// boolean even when the field is absent (count(missing) is null → coalesce).
		expect(papersQuery).toContain('darcstarAuthored');
		expect(papersQuery).toContain('"hasCommentary": coalesce(count(commentary) > 0, false)');
		// Full projection pinned: `description` feeds the topic tooltip on the list cards.
		expect(papersQuery).toContain(
			'"topics": array::compact(topics[]->{ _id, title, "slug": slug.current, description })'
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
		expect(peopleQuery).toContain('order(name asc)');
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
