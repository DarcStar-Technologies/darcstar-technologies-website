import { expect, test } from '@playwright/test';

// The privacy policy (DAR-44) is reachable from the footer legal bar and renders the real
// document through the Cloudflare worker build. Each form's data-handling notice is asserted
// in that form's own spec (contact / waitlist / signup).
test('footer links to the privacy policy and the page renders its sections', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy', exact: true }).click();

	await expect(page).toHaveURL(/\/privacy$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
	await expect(page.getByRole('heading', { name: 'What we collect' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Where it lives' })).toBeVisible();

	// DAR-121's deliverable: "How we use it" names the two categories of mail separately, because
	// one paragraph is what let the policy say waitlist email is "only about early access" while the
	// signup form offered product updates. Both headings, so losing either fails.
	await expect(page.getByRole('heading', { name: 'Operational email' })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Optional product and research updates' })
	).toBeVisible();
	await expect(
		page.getByRole('main').getByRole('link', { name: 'info@darcstar.tech' })
	).toBeVisible();
});
