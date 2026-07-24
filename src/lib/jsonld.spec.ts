import { describe, expect, it } from 'vitest';
import {
	articleJsonLd,
	breadcrumbJsonLd,
	jsonLdScript,
	organizationId,
	organizationJsonLd,
	peopleJsonLd,
	scholarlyArticleJsonLd
} from './jsonld';

const ORIGIN = 'https://darcstar.tech';

/** Parse the payload back out of the rendered <script> tag — asserts it round-trips as JSON. */
function parseScript(script: string): Record<string, unknown> {
	const inner = script
		.replace(/^<script type="application\/ld\+json">/, '')
		.replace(/<\/script>$/, '');
	return JSON.parse(inner);
}

describe('jsonLdScript', () => {
	it('wraps a single node with @context', () => {
		const parsed = parseScript(jsonLdScript({ '@type': 'Thing', name: 'x' }));
		expect(parsed['@context']).toBe('https://schema.org');
		expect(parsed['@type']).toBe('Thing');
	});

	it('wraps multiple nodes in @graph', () => {
		const parsed = parseScript(jsonLdScript([{ '@type': 'A' }, { '@type': 'B' }]));
		expect(parsed['@context']).toBe('https://schema.org');
		expect(parsed['@graph']).toEqual([{ '@type': 'A' }, { '@type': 'B' }]);
	});

	it('neutralizes </script> in content so the tag cannot be terminated early', () => {
		const hostile = 'pwn</script><script>alert(1)</script>';
		const script = jsonLdScript({ '@type': 'Article', headline: hostile });
		// Exactly one </script> — the tag's own terminator; the payload's copies are <-escaped.
		expect(script.split('</script>')).toHaveLength(2);
		expect(script.endsWith('</script>')).toBe(true);
		// And the escape is lossless: the hostile string parses back byte-identical.
		expect(parseScript(script).headline).toBe(hostile);
	});

	it('drops undefined-valued fields entirely', () => {
		const parsed = parseScript(jsonLdScript({ '@type': 'Thing', name: undefined }));
		expect('name' in parsed).toBe(false);
	});

	it('renders nothing at all for an empty node array', () => {
		expect(jsonLdScript([])).toBe('');
	});

	it('enforces the schema.org context over a node-supplied one', () => {
		const parsed = parseScript(jsonLdScript({ '@context': 'https://evil.example', '@type': 'X' }));
		expect(parsed['@context']).toBe('https://schema.org');
	});
});

describe('organizationJsonLd', () => {
	it('carries the settled public facts', () => {
		const org = organizationJsonLd(ORIGIN);
		expect(org['@id']).toBe(`${ORIGIN}/#organization`);
		expect(org['@id']).toBe(organizationId(ORIGIN));
		expect(org.name).toBe('DarcStar Technologies');
		expect(org.url).toBe(`${ORIGIN}/`);
		expect(org.email).toBe('info@darcstar.tech');
		expect(org.sameAs).toEqual(['https://github.com/DarcStar-Technologies']);
		expect(org.address).toEqual({ '@type': 'PostalAddress', addressCountry: 'US' });
		expect(org.logo).toMatch(new RegExp(`^${ORIGIN}/.+`));
	});
});

describe('peopleJsonLd', () => {
	it('maps team docs to Person nodes tied to the org', () => {
		const [person] = peopleJsonLd(
			[
				{
					name: 'Ada Lovelace',
					role: 'Chief Scientist',
					// Pre-resolved by the caller (image.ts's imageUrl) — jsonld stays builder-free.
					image: 'https://cdn.sanity.io/images/p/d/ada-600x600.jpg',
					socialLinks: [
						{ label: 'GitHub', url: 'https://github.com/ada' },
						{ label: 'broken', url: null }
					]
				}
			],
			ORIGIN
		);
		expect(person['@type']).toBe('Person');
		expect(person.name).toBe('Ada Lovelace');
		expect(person.jobTitle).toBe('Chief Scientist');
		expect(person.image).toBe('https://cdn.sanity.io/images/p/d/ada-600x600.jpg');
		// Null link URLs are dropped rather than serialized as null.
		expect(person.sameAs).toEqual(['https://github.com/ada']);
		expect(person.worksFor).toEqual({ '@id': organizationId(ORIGIN) });
	});

	it('drops nameless docs and collapses empty link lists', () => {
		const people = peopleJsonLd([{ name: null }, { name: 'B', socialLinks: [] }], ORIGIN);
		expect(people).toHaveLength(1);
		expect(people[0].sameAs).toBeUndefined();
		expect(people[0].image).toBeUndefined();
	});
});

describe('articleJsonLd', () => {
	it('builds an Article anchored to the page URL and org', () => {
		const url = `${ORIGIN}/news/hello-world`;
		const article = articleJsonLd(
			{
				title: 'Hello world',
				excerpt: 'First post.',
				publishedAt: '2026-07-01T00:00:00Z',
				_updatedAt: '2026-07-02T00:00:00Z',
				authors: [{ name: 'Ada Lovelace' }, { name: null }]
			},
			{ url, image: 'https://cdn.sanity.io/images/x/y/card.png' }
		);
		expect(article['@type']).toBe('Article');
		expect(article.headline).toBe('Hello world');
		expect(article.datePublished).toBe('2026-07-01T00:00:00Z');
		expect(article.dateModified).toBe('2026-07-02T00:00:00Z');
		expect(article.mainEntityOfPage).toBe(url);
		expect(article.publisher).toEqual({ '@id': organizationId(ORIGIN) });
		// The null-named author is filtered, not serialized as a hollow Person.
		expect(article.author).toEqual([{ '@type': 'Person', name: 'Ada Lovelace' }]);
	});

	it('serializes sparse posts without null noise', () => {
		const parsed = parseScript(
			jsonLdScript(articleJsonLd({ title: 'Bare' }, { url: `${ORIGIN}/news/bare` }))
		);
		expect(parsed.headline).toBe('Bare');
		for (const absent of ['description', 'datePublished', 'dateModified', 'image', 'author']) {
			expect(absent in parsed, `${absent} should be absent`).toBe(false);
		}
	});
});

describe('scholarlyArticleJsonLd', () => {
	it('collects external identities into sameAs', () => {
		const paper = scholarlyArticleJsonLd(
			{
				title: 'On Things',
				abstract: 'We prove things.',
				publishedDate: '2026-05-01',
				url: 'https://proceedings.example/on-things',
				doi: '10.1234/abcd',
				arxivId: '2605.01234'
			},
			{ url: `${ORIGIN}/research/on-things` }
		);
		expect(paper['@type']).toBe('ScholarlyArticle');
		expect(paper.sameAs).toEqual([
			'https://proceedings.example/on-things',
			'https://doi.org/10.1234/abcd',
			'https://arxiv.org/abs/2605.01234'
		]);
		expect(paper.mainEntityOfPage).toBe(`${ORIGIN}/research/on-things`);
	});

	it('omits sameAs when a paper has no external identity', () => {
		const paper = scholarlyArticleJsonLd({ title: 'Internal' }, { url: `${ORIGIN}/research/x` });
		expect(paper.sameAs).toBeUndefined();
	});
});

describe('breadcrumbJsonLd', () => {
	it('numbers positions from 1 and drops nameless crumbs', () => {
		const crumbs = breadcrumbJsonLd([
			{ name: 'Home', url: `${ORIGIN}/` },
			{ name: null, url: `${ORIGIN}/ghost` },
			{ name: 'News', url: `${ORIGIN}/news` }
		]);
		expect(crumbs.itemListElement).toEqual([
			{ '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
			{ '@type': 'ListItem', position: 2, name: 'News', item: `${ORIGIN}/news` }
		]);
	});
});
