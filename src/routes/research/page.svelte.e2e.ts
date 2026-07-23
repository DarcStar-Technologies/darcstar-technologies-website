import { expect, test } from '@playwright/test';

// /research renders the papers index through the real worker build (SSR fetch of published papers).
// Chrome-only assertion — resilient to live content and to a transient Sanity outage (empty index).
test('research page renders its hero heading', async ({ page }) => {
	await page.goto('/research');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Papers');
});
