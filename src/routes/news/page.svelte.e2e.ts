import { expect, test } from '@playwright/test';

// /news renders end-to-end through the real Cloudflare worker build, SSR-fetching published posts
// from Sanity. Content is live data, so this asserts the page CHROME (hero heading) — which renders
// whether the feed has posts, is empty, or Sanity is briefly unreachable (the load degrades to an
// empty feed rather than 500-ing).
test('news page renders its hero heading', async ({ page }) => {
	await page.goto('/news');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('News');
});

// DAR-94: `?page=` is a view of the index, not a page of its own. Content-free, so it holds in CI
// (where the feed is empty for want of SANITY_VIEWER_TOKEN) as well as against real content —
// `Seo.svelte` derives both tags from `page.url.pathname`, which excludes the query string. That
// behaviour is what makes paginated views safe to leave out of the sitemap, and it was ALREADY true
// before this ticket, which is exactly why it needs a test: nothing else would notice it breaking.
test('paginated views canonicalise to the bare index', async ({ page }) => {
	// `?page=1`, not `?page=2`: a page past the end REDIRECTS, so on a short feed (or the empty one
	// CI renders without SANITY_VIEWER_TOKEN) `?page=2` would land on `/news` and this would only be
	// asserting that `/news` canonicalises to `/news`. Page 1 is in range for any corpus, so the URL
	// under test keeps its query string and the assertion is about what the tag does with it.
	await page.goto('/news?page=1');
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/news$/);
	// og:url too — it is derived separately from the canonical (DAR-70 split them deliberately), so
	// a share of a paged view must still identify itself as /news rather than as /news?page=2.
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', /\/news$/);
});
