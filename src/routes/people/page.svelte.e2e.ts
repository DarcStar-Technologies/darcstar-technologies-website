import { expect, test } from '@playwright/test';

// /people renders the team grid through the real worker build (SSR fetch of internal `person` docs).
// Chrome-only assertion — resilient to live content and to a transient Sanity outage (empty grid).
test('people page renders its hero heading', async ({ page }) => {
	await page.goto('/people');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('team');
});
