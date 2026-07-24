import { expect, test } from '@playwright/test';

// /evidence (DAR-43) — static content page (no Sanity, no DB), so unlike the content-feed
// specs this needs no degradation guard: the full surface must render in every environment.
test('evidence page renders the hero, the claim cards, and the IP boundary', async ({ page }) => {
	await page.goto('/evidence');

	await expect(page.getByRole('heading', { level: 1 })).toContainText('Claims you can');

	// One heading per claim card — the h2 set is the page's contract with the homepage claims.
	await expect(page.getByRole('heading', { name: 'CfC kernel inference' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Faster than real time' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Theorems machine-checked' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Formal safety guarantees' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Domains shipped' })).toBeVisible();

	// The load-bearing honesty content: the machine-checked breakdown and the IP boundary.
	await expect(page.getByText('219 of the 338 catalogued theorems')).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'What we deliberately do not publish' })
	).toBeVisible();
});

// The DAR-43 complaint was "no path from claim to evidence" — pin the path: the homepage
// stats row shows the corrected machine-checked count and links through to /evidence.
test('homepage stats row links through to the evidence page', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByText('theorems machine-checked')).toBeVisible();
	await page.getByRole('link', { name: 'How we verify these numbers' }).click();

	await expect(page).toHaveURL(/\/evidence$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Claims you can');
});
