import { expect, test } from '@playwright/test';

// /news renders end-to-end through the real Cloudflare worker build, SSR-fetching published posts
// from Sanity. Content is live data, so this asserts the page CHROME (hero heading) — which renders
// whether the feed has posts, is empty, or Sanity is briefly unreachable (the load degrades to an
// empty feed rather than 500-ing).
test('news page renders its hero heading', async ({ page }) => {
	await page.goto('/news');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('News');
});
