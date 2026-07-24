import { expect, test } from '@playwright/test';

// /sitemap.xml + JSON-LD structured data (DAR-48), asserted through the real Cloudflare worker
// build. Content-driven specifics (posts/papers in the sitemap, Article/Person nodes) depend on
// what the live Sanity dataset holds, so these tests pin the DETERMINISTIC surface: the static
// URL set, origin absolutization, exclusion of gated/untranslated trees, the robots.txt pointer,
// and the site-wide Organization node. Builder output shapes are unit-tested in
// src/lib/jsonld.spec.ts; CSP-compatibility of the inline JSON-LD data blocks is proven by the
// violation guard in security-headers.e2e.ts (/, /people are audited pages).

const STATIC_PATHS = [
	'/',
	'/about',
	'/news',
	'/research',
	'/people',
	'/contact',
	'/waitlist',
	'/privacy',
	'/terms'
];

test('sitemap.xml lists the public pages, absolutized to the serving origin', async ({
	request
}) => {
	const res = await request.get('/sitemap.xml');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('application/xml');
	// A worker route, not an asset — the DAR-45 header set must ride along.
	expect(res.headers()['x-content-type-options']).toBe('nosniff');

	const origin = new URL(res.url()).origin;
	const body = await res.text();
	expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
	for (const path of STATIC_PATHS) {
		expect(body).toContain(`<loc>${origin}${path === '/' ? '/' : path}</loc>`);
	}

	// Every <loc> is on-origin — absolutization works and no stray host leaks in.
	const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
	expect(locs.length).toBeGreaterThanOrEqual(STATIC_PATHS.length);
	for (const loc of locs) {
		expect(loc.startsWith(`${origin}/`), `${loc} should be on ${origin}`).toBe(true);
	}

	// Gated/noindex surfaces and the untranslated /es tree (noindex placeholder) stay out.
	for (const excluded of ['/admin', '/account', '/login', '/signup', '/forgot-password', '/es']) {
		const hit = locs.find(
			(loc) => loc === origin + excluded || loc.startsWith(`${origin}${excluded}/`)
		);
		expect(hit, `${excluded} must not be in the sitemap`).toBeUndefined();
	}
});

test('robots.txt points crawlers at the production sitemap', async ({ request }) => {
	const res = await request.get('/robots.txt');
	expect(res.ok()).toBe(true);
	// The prod origin is hardcoded (static asset — see the comment in static/robots.txt).
	expect(await res.text()).toContain('Sitemap: https://darcstar.tech/sitemap.xml');
});

test('the homepage carries the site-wide Organization JSON-LD', async ({ page }) => {
	await page.goto('/');
	const scripts = page.locator('script[type="application/ld+json"]');
	// Exactly one on the homepage: the layout's Organization (the home <Seo> passes no jsonLd).
	await expect(scripts).toHaveCount(1);

	const parsed = JSON.parse((await scripts.first().textContent()) ?? 'null');
	expect(parsed['@context']).toBe('https://schema.org');
	expect(parsed['@type']).toBe('Organization');
	expect(parsed['@id']).toBe(`${new URL(page.url()).origin}/#organization`);
	expect(parsed.name).toBe('DarcStar Technologies');
	expect(parsed.sameAs).toContain('https://github.com/DarcStar-Technologies');
});

test('structured data on /people parses and every node is typed', async ({ page }) => {
	await page.goto('/people');
	const contents = await page.locator('script[type="application/ld+json"]').allTextContents();
	// At least the layout's Organization; a populated team adds the page's Person graph. Whatever
	// is present must be valid JSON with typed nodes — a serializer regression fails loudly here.
	expect(contents.length).toBeGreaterThanOrEqual(1);
	for (const raw of contents) {
		const parsed = JSON.parse(raw);
		const nodes = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
		for (const node of nodes) {
			expect(node['@type']).toBeTruthy();
		}
	}
});
