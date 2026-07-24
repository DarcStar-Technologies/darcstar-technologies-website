import { expect, test } from '@playwright/test';

// /research renders the papers index through the real worker build (SSR fetch of published papers).
// Chrome-only assertions — resilient to live content and to a transient Sanity outage (empty index).
// The lede check is DAR-52's credibility fix: the hero must no longer claim every entry as
// DarcStar work (per-entry origin chips/disclaimers are content-dependent → unit-tested instead).
test('research page renders its hero heading and origin-honest lede', async ({ page }) => {
	await page.goto('/research');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Papers');
	await expect(page.getByText('alongside the foundational third-party research')).toBeVisible();
});
