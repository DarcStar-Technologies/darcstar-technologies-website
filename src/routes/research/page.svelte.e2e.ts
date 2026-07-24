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

// The filter bar is chrome (renders regardless of content), and URL params SSR into the
// controls — so a filtered deep link works without JS. Facet OPTIONS are content-derived and
// deliberately not asserted; the origin/sort sets are static.
test('filter bar renders and SSRs the URL state into its controls', async ({ page }) => {
	await page.goto('/research?origin=external&sort=title');
	const main = page.getByRole('main');
	await expect(main.getByLabel('Topic')).toBeVisible();
	await expect(main.getByLabel('Author')).toBeVisible();
	await expect(main.getByLabel('Origin')).toHaveValue('external');
	await expect(main.getByLabel('Sort by')).toHaveValue('title');
	await expect(main.getByRole('button', { name: 'Apply' })).toBeVisible();
	await expect(main.getByRole('link', { name: 'Clear filters' })).toBeVisible();
});
