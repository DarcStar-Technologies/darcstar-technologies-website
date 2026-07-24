import { describe, expect, it } from 'vitest';
import { postsQuery, postBySlugQuery, papersQuery, paperBySlugQuery, peopleQuery } from './queries';

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
	});

	it('papersQuery selects published papers newest-first with the origin + annotation flags', () => {
		expect(papersQuery).toContain('_type == "paper"');
		expect(papersQuery).toContain('order(publishedDate desc)');
		// DAR-52: the /research split renders darcstarAuthored, and hasCommentary must be a
		// boolean even when the field is absent (count(missing) is null → coalesce).
		expect(papersQuery).toContain('darcstarAuthored');
		expect(papersQuery).toContain('"hasCommentary": coalesce(count(commentary) > 0, false)');
	});

	it('paperBySlugQuery is slug-parameterised and pulls the PDF URL + commentary', () => {
		expect(paperBySlugQuery).toContain('slug.current == $slug');
		expect(paperBySlugQuery).toContain('"pdfUrl": pdf.asset->url');
		expect(paperBySlugQuery).toContain('darcstarAuthored');
		expect(paperBySlugQuery).toContain('commentary');
	});

	it('peopleQuery selects the team (non-external persons), name-sorted', () => {
		expect(peopleQuery).toContain('_type == "person"');
		// `!= "external"` (not `== "internal"`) so an unset `kind` still counts as team.
		expect(peopleQuery).toContain('kind != "external"');
		expect(peopleQuery).toContain('order(name asc)');
	});
});
