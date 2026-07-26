import { describe, expect, it } from 'vitest';
import {
	articleJsonLd,
	breadcrumbJsonLd,
	jsonLdScript,
	organizationId,
	organizationJsonLd,
	paperCanonicalUrl,
	paperSourceUrls,
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

	// `sameAs` became CMS-driven in DAR-73 (siteSettings.socialLinks, via the root layout). The
	// default has to survive untouched: pages/tests with no CMS data must still publish the GitHub
	// identity rather than an org with none.
	it('publishes the CMS social profiles as sameAs when given them', () => {
		const org = organizationJsonLd(ORIGIN, {
			sameAs: ['https://github.com/DarcStar-Technologies', 'https://bsky.app/profile/x']
		});
		expect(org.sameAs).toEqual([
			'https://github.com/DarcStar-Technologies',
			'https://bsky.app/profile/x'
		]);
	});

	it.each([
		['an omitted option', undefined],
		['an empty list', []],
		['a list of only unusable URLs', ['/relative', 'javascript:alert(1)']]
	])('keeps the hardcoded GitHub identity for %s', (_why, sameAs) => {
		const org = organizationJsonLd(ORIGIN, { sameAs });
		expect(org.sameAs).toEqual(['https://github.com/DarcStar-Technologies']);
	});

	// The value is published as the organization's identity, so it gets the same gate the canonical
	// derivation uses — the Studio's url validation is a UI affordance an API write skips.
	it('drops unusable URLs from a mixed list', () => {
		const org = organizationJsonLd(ORIGIN, {
			sameAs: ['https://bsky.app/profile/x', 'mailto:info@darcstar.tech', 'https://a b.example']
		});
		expect(org.sameAs).toEqual(['https://bsky.app/profile/x']);
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

// DAR-70: this list has two consumers — `sameAs` below, and /research/[slug]'s canonical fallback,
// which takes [0]. So ORDER is load-bearing in a way it never was for sameAs alone: `url` (the
// publisher/landing page) first, then the DOI (version of record), and only then arXiv (usually the
// preprint). Getting it wrong points crawlers at a preprint over the published paper.
describe('paperSourceUrls', () => {
	const full = {
		url: 'https://proceedings.example/on-things',
		doi: '10.1234/abcd',
		arxivId: '2605.01234'
	};

	it('orders url → doi → arxiv, building the doi.org and arxiv.org URLs', () => {
		expect(paperSourceUrls(full)).toEqual([
			'https://proceedings.example/on-things',
			'https://doi.org/10.1234/abcd',
			'https://arxiv.org/abs/2605.01234'
		]);
	});

	it('closes the gaps rather than leaving holes, so [0] is always the best available source', () => {
		expect(paperSourceUrls({ doi: '10.1234/abcd', arxivId: '2605.01234' })[0]).toBe(
			'https://doi.org/10.1234/abcd'
		);
		expect(paperSourceUrls({ arxivId: '2605.01234' })[0]).toBe('https://arxiv.org/abs/2605.01234');
		expect(paperSourceUrls({ url: full.url, arxivId: '2605.01234' })).toEqual([
			full.url,
			'https://arxiv.org/abs/2605.01234'
		]);
	});

	it('returns [] when the paper names no source at all', () => {
		// The canonical caller reads [0] — undefined here, which keeps the page self-canonical.
		expect(paperSourceUrls({})).toEqual([]);
		expect(paperSourceUrls({ url: null, doi: null, arxivId: null })).toEqual([]);
		expect(paperSourceUrls({})[0]).toBeUndefined();
	});

	it('drops anything that is not an absolute http(s) URL', () => {
		// `doi`/`arxivId` are unvalidated free text in the Studio, and this list now feeds a
		// canonical — where a malformed value actively misdirects crawlers instead of being ignored.
		expect(paperSourceUrls({ url: 'javascript:alert(1)' })).toEqual([]);
		expect(paperSourceUrls({ url: 'mailto:someone@example.com' })).toEqual([]);
		expect(paperSourceUrls({ url: '/research/relative-path' })).toEqual([]);
		expect(paperSourceUrls({ url: 'not a url at all' })).toEqual([]);
	});

	it('drops a prose-filled doi/arxiv field, which `new URL` alone would accept', () => {
		// The trap: `new URL('https://doi.org/see the paper')` does NOT throw — it percent-encodes
		// the spaces into a well-formed URL that 404s. Protocol-checking alone misses this entirely.
		expect(paperSourceUrls({ doi: 'see the paper for details' })).toEqual([]);
		expect(paperSourceUrls({ arxivId: 'not published yet' })).toEqual([]);
		// And one bad field can't take a good one down with it.
		expect(paperSourceUrls({ url: full.url, doi: 'see the paper' })).toEqual([full.url]);
	});

	it('tolerates surrounding whitespace on an otherwise good value', () => {
		expect(paperSourceUrls({ url: `  ${full.url}  `, doi: ' 10.1234/abcd ' })).toEqual([
			full.url,
			'https://doi.org/10.1234/abcd'
		]);
	});
});

// DAR-70's polarity, extracted out of the page component precisely so it can be asserted: a
// mutation that dropped the first-party exemption altogether passed `pnpm check` and every test
// while the rule was inline, because nothing could reach it.
describe('paperCanonicalUrl', () => {
	const source = { url: 'https://arxiv.org/abs/1706.03762' };

	it('keeps our own work self-canonical', () => {
		expect(paperCanonicalUrl({ ...source, darcstarAuthored: true })).toBeUndefined();
	});

	it.each([
		['explicitly false', false],
		['null', null],
		['absent', undefined]
	])('canonicalises to the source when darcstarAuthored is %s', (_case, darcstarAuthored) => {
		// Fail-safe: only an explicit `true` counts as ours, so the failure mode of a half-filled
		// document is under-claiming our own page — never claiming someone else's work.
		expect(paperCanonicalUrl({ ...source, darcstarAuthored })).toBe(source.url);
	});

	it('stays self-canonical when a third-party paper names no usable source', () => {
		expect(paperCanonicalUrl({ darcstarAuthored: false })).toBeUndefined();
		expect(paperCanonicalUrl({ darcstarAuthored: false, url: 'not a url' })).toBeUndefined();
	});

	it('takes the most authoritative source available', () => {
		expect(
			paperCanonicalUrl({ darcstarAuthored: false, doi: '10.1234/abcd', arxivId: '2605.01234' })
		).toBe('https://doi.org/10.1234/abcd');
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

	it('claims the org as publisher ONLY for first-party papers (DAR-52 fail-safe polarity)', () => {
		const url = `${ORIGIN}/research/x`;
		const ours = scholarlyArticleJsonLd({ title: 'Ours', darcstarAuthored: true }, { url });
		expect(ours.publisher).toEqual({ '@id': organizationId(ORIGIN) });
		// Explicitly external AND unset/null both mean third-party — never claim publisher.
		for (const darcstarAuthored of [false, null, undefined]) {
			const external = scholarlyArticleJsonLd({ title: 'Not ours', darcstarAuthored }, { url });
			expect(external.publisher, `darcstarAuthored=${darcstarAuthored}`).toBeUndefined();
		}
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
