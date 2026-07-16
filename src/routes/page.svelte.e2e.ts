import { expect, test } from '@playwright/test';

// Homepage smoke test: the marketing page renders end-to-end (through the real
// Cloudflare worker build) with its hero, a downstage section, and the CTAs.
test('homepage renders the hero, a section and the CTAs', async ({ page }) => {
	await page.goto('/');

	// Brand in the header
	await expect(page.getByRole('banner')).toContainText('DarcStar');

	// Hero headline
	const h1 = page.getByRole('heading', { level: 1 });
	await expect(h1).toContainText('Autonomous control');
	await expect(h1).toContainText('is safe.');

	// A below-the-fold section + the telemetry readout render
	await expect(page.getByRole('heading', { name: 'Proven, not just tested.' })).toBeVisible();
	await expect(page.getByText('CfC inference')).toBeVisible();

	// Primary CTAs
	await expect(page.getByRole('link', { name: 'Explore GIDE' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Contact Us' })).toBeVisible();
});
