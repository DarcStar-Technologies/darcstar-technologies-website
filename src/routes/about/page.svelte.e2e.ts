import { expect, test } from '@playwright/test';

// The /about page (issue #61) renders real content through the Cloudflare worker build:
// the intro heading, a downstage section, the settled public facts, and a contact CTA
// that opens the shared modal.
test('about page renders its heading, facts and contact CTA', async ({ page }) => {
	await page.goto('/about');

	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'safety for autonomous systems'
	);

	// A below-the-fold section + the at-a-glance facts render. Scope "United States" to
	// <main> — the footer prints it too (issue #12), so an unscoped match is ambiguous.
	await expect(page.getByRole('heading', { name: 'Our mission' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
	await expect(page.getByRole('main').getByText('United States')).toBeVisible();
	await expect(page.getByRole('link', { name: 'info@darcstar.tech' })).toBeVisible();

	// The contact CTA opens the shared modal (issue #11).
	await page.getByRole('button', { name: 'Get in touch' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
});
