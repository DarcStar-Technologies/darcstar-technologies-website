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

	// Primary CTAs — "Explore GIDE" is an in-page anchor; "Contact Us" now opens the
	// contact modal, so it's a button (issue #11).
	await expect(page.getByRole('link', { name: 'Explore GIDE' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Contact Us' })).toBeVisible();
});

// The contact modal (issue #11) opens from the CTA, shows its fields, and closes on
// Esc. The happy-path submit (which writes to Turso) is verified manually, not here —
// validation itself is covered by src/lib/server/contact.spec.ts.
test('contact modal opens from the CTA and closes on Escape', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Contact Us' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();

	await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('Message', { exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Send message' })).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(dialog).not.toBeVisible();
});
