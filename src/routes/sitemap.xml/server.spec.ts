import { beforeEach, describe, expect, it, vi } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { TRANSLATED_LOCALES } from '$lib/seo';

// The sitemap endpoint had no test at all until DAR-122, and the gap it left is specific: a content
// type here is TWO halves — an arm in `sitemapEntriesQuery` and a mapping in the handler — and the
// second one is silent when forgotten. The query keeps type-checking, the handler keeps returning
// 200, and the sitemap simply comes back missing a third of the site.
//
// Nothing else can see that. CI's e2e runs without SANITY_VIEWER_TOKEN (DAR-96), so every CMS-driven
// <loc> is absent there by construction and seo.e2e.ts can only assert the STATIC paths — it would
// pass, unchanged, against a handler that dropped posts, papers and people on the floor. Unit-testing
// the handler against a mocked client is the only place the two halves meet.
//
// That is the same shape DAR-71 hit (a `seo` field fetched, typed, and dropped at both render sites)
// and the same fix: put the composition under test rather than each half separately.

const fetchSpy = vi.fn();
vi.mock('$lib/server/sanity', () => ({ getSanityClient: () => ({ fetch: fetchSpy }) }));

// `localizeHref` resolves the AMBIENT locale even when handed an explicit one (it compares the two to
// decide whether a relative path can stay relative), and with the `url` strategy there is no ambient
// locale outside a request — it throws. Paraglide's own escape hatch supplies one. Not mocked away:
// the localization is what turns a slug into a path, and mocking it would leave this spec asserting
// its own string concatenation. Vitest isolates test files, so this stays inside this module.
overwriteGetLocale(() => 'en');

const { GET } = await import('./+server');

const ORIGIN = 'https://darcstar.tech';

/** Only `url` is read off the RequestEvent. */
const call = () =>
	(GET as (event: { url: URL }) => Promise<Response>)({ url: new URL(`${ORIGIN}/sitemap.xml`) });

const locs = (body: string) => [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
/** The `<lastmod>` sitting in the same `<url>` element as `loc`, if any. */
const lastmodFor = (body: string, loc: string) =>
	body.match(new RegExp(`<loc>${loc}</loc><lastmod>([^<]+)</lastmod>`))?.[1];

// One document per content type, each with a distinct date so a mapping that reads the wrong
// collection's `_updatedAt` shows up as a wrong value rather than a coincidental match.
const ENTRIES = {
	posts: [{ slug: 'hello-from-darcstar', _updatedAt: '2026-07-22T00:00:00Z' }],
	papers: [{ slug: 'intelligence-ratchet', _updatedAt: '2026-02-04T00:00:00Z' }],
	people: [{ slug: 'michael-harris', _updatedAt: '2026-07-28T00:00:00Z' }]
};

// What each collection is expected to become. Table-driven so a FOURTH content type is one row here
// plus one mapping in the handler — and a row with no mapping fails loudly instead of being a
// sitemap nobody notices is short.
const ROUTES: { collection: keyof typeof ENTRIES; path: string }[] = [
	{ collection: 'posts', path: '/news' },
	{ collection: 'papers', path: '/research' },
	{ collection: 'people', path: '/people' }
];

beforeEach(() => {
	fetchSpy.mockReset();
	fetchSpy.mockResolvedValue(ENTRIES);
});

describe('GET /sitemap.xml', () => {
	it.each(ROUTES)('lists every $collection document under $path', async ({ collection, path }) => {
		const body = await (await call()).text();
		for (const entry of ENTRIES[collection]) {
			const loc = `${ORIGIN}${path}/${entry.slug}`;
			expect(
				locs(body),
				`${collection} are fetched but never mapped into the sitemap — see the two-halves note in +server.ts`
			).toContain(loc);
			// The document's own timestamp, not another collection's and not a fabricated one.
			expect(lastmodFor(body, loc)).toBe(entry._updatedAt);
		}
	});

	it('serves the static marketing pages alongside them', async () => {
		const body = await (await call()).text();
		for (const path of ['/', '/about', '/news', '/research', '/people', '/privacy']) {
			expect(locs(body)).toContain(`${ORIGIN}${path}`);
		}
	});

	it('emits one document per translated locale and nothing for the rest', async () => {
		const body = await (await call()).text();
		// Every <loc> is on-origin and inside a real locale tree. Derived from the same flag the
		// endpoint reads, so the day `es` becomes real this expectation moves with it.
		expect(TRANSLATED_LOCALES).toContain('en');
		expect(locs(body).filter((loc) => loc.startsWith(`${ORIGIN}/es`))).toEqual([]);
		expect(locs(body).every((loc) => loc.startsWith(`${ORIGIN}/`))).toBe(true);
		// Floor: `every` on an empty list is vacuously true, so prove the parse found the document.
		expect(locs(body).length).toBeGreaterThan(ROUTES.length);
	});

	// Same posture as the list loads: a Sanity outage costs the CONTENT entries, never the document.
	// Crawlers treat a failing sitemap far worse than a temporarily thinner one.
	it('still serves the static sitemap when Sanity is unreachable', async () => {
		fetchSpy.mockRejectedValue(new Error('sanity down'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const res = await call();
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(locs(body)).toContain(`${ORIGIN}/people`);
		// ...and no half-built content URL leaks through from an undefined collection.
		expect(locs(body).some((loc) => loc.includes('undefined'))).toBe(false);
		for (const { path } of ROUTES) {
			expect(locs(body).some((loc) => loc.startsWith(`${ORIGIN}${path}/`))).toBe(false);
		}
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('is served as XML through the worker, cacheable by crawlers', async () => {
		const res = await call();
		expect(res.headers.get('content-type')).toContain('application/xml');
		expect(res.headers.get('cache-control')).toContain('max-age=');
		const body = await res.text();
		expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
	});

	// A slug is interpolated straight into the document, so a markup character in one would produce
	// invalid XML — which crawlers reject WHOLESALE, taking the entire sitemap down rather than
	// dropping one entry. Two different mechanisms happen to cover it (`new URL` percent-encodes `<`
	// on its way through localizeHref; `&` survives that and is caught by escapeXml), so the assertion
	// is on the OUTCOME rather than on either one.
	it('emits a well-formed document however a slug is spelled', async () => {
		fetchSpy.mockResolvedValue({
			posts: [],
			papers: [],
			people: [{ slug: 'a&b<c', _updatedAt: '2026-07-28T00:00:00Z' }]
		});
		const body = await (await call()).text();
		expect(locs(body)).toContain(`${ORIGIN}/people/a&amp;b%3Cc`);
		// Nothing markup-significant from the slug reaches the document raw: every `&` is an entity,
		// and no angle bracket survives inside a URL.
		expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
		expect(body).not.toContain('a&b<c');
	});
});
