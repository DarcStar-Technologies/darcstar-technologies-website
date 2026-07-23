import { expect, test } from '@playwright/test';

// The privacy policy (DAR-44) is reachable from the footer legal bar and renders the real
// document through the Cloudflare worker build.
test('footer links to the privacy policy and the page renders its sections', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy', exact: true }).click();

	await expect(page).toHaveURL(/\/privacy$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
	await expect(page.getByRole('heading', { name: 'What we collect' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Where it lives' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your choices' })).toBeVisible();
	await expect(
		page.getByRole('main').getByRole('link', { name: 'info@darcstar.tech' })
	).toBeVisible();
});

// The data-collecting forms carry a nearby notice pointing here (DAR-44): the standalone
// /contact page (which shares ContactFields with the modal, so the modal is covered by the
// same markup) and /waitlist.
test('contact and waitlist forms carry a data-handling notice', async ({ page }) => {
	await page.goto('/contact');
	await expect(page.getByRole('link', { name: 'How we handle your data' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);

	await page.goto('/waitlist');
	await expect(page.getByRole('link', { name: 'How we handle your data' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);
});
