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

// The header About link now navigates to the real /about page (issue #61); the old
// in-page #about footer anchor and its smooth-scroll enhancement were retired.
test('header About link navigates to the about page', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('link', { name: 'About' }).click();

	await expect(page).toHaveURL(/\/about$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'safety for autonomous systems'
	);
});

// Regression: the glass sheen light-plane lives in the persistent layout, so its clip-path
// (the union of the CURRENT route's glass panels) must be rebuilt on client-side navigation.
// Before the afterNavigate re-clip, the beam stayed pinned to the previous page's panels — a
// ghost that only realigned after a scroll or refresh. Here the clip must change to the about
// page's (fewer, differently-placed) panels with NO scroll (the user's old workaround).
test('the glass sheen clip-path is rebuilt on navigation (no ghost of the prior page)', async ({
	page
}) => {
	await page.goto('/');

	const clipPath = () =>
		page.evaluate(() => document.querySelector<HTMLElement>('.sheen-plane')?.style.clipPath ?? '');

	// The clip is applied an rAF after load; wait for it, then capture the homepage geometry.
	await expect.poll(clipPath).not.toBe('');
	const homeClip = await clipPath();

	// SPA navigation (link click, not a reload) to a page whose panels differ from home's.
	await page.getByRole('link', { name: 'About' }).click();
	await expect(page).toHaveURL(/\/about$/);

	// Without the fix this stays === homeClip forever (poll would time out); with it, the clip
	// rebuilds to the about page's panels promptly and with no scroll.
	await expect.poll(clipPath).not.toBe(homeClip);
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
