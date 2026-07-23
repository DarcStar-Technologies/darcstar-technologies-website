import { expect, test } from '@playwright/test';

// The terms of service (DAR-44) are reachable from the footer legal bar and render the real
// document through the Cloudflare worker build.
test('footer links to the terms and the page renders its sections', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('contentinfo').getByRole('link', { name: 'Terms', exact: true }).click();

	await expect(page).toHaveURL(/\/terms$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Terms');
	await expect(page.getByRole('heading', { name: 'Using the site' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Limitation of liability' })).toBeVisible();
});

// Sign-up shows the agreement line linking both legal pages (DAR-44).
test('signup form carries the terms + privacy agreement links', async ({ page }) => {
	await page.goto('/signup');
	await expect(page.getByRole('link', { name: 'terms of service' })).toHaveAttribute(
		'href',
		/\/terms$/
	);
	await expect(page.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);
});
