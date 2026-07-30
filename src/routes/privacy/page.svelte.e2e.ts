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

// DAR-136. "Where it lives" presents itself as a COMPLETE list — "a small set of service providers
// process it on our behalf" and then the names — so a provider receiving personal data and missing
// from it makes the page untrue. `crm-egress.spec.ts` guards who may PRODUCE; nothing there can see
// whether the disclosure actually renders, and that is DAR-117's lesson: only an e2e can. Deleting the
// Twenty entry from +page.svelte leaves the message key in place, every unit test green, and the site
// still producing to a processor it no longer names (mutation-verified: this is the only test that
// goes red).
//
// The whole set rather than Twenty alone, because losing any of them is the same defect, and by
// heading role so a name that merely appears in some other paragraph cannot satisfy it.
test('every processor the site sends personal data to is named on the page', async ({ page }) => {
	await page.goto('/privacy');
	await expect(page.getByRole('heading', { name: 'Where it lives' })).toBeVisible();

	for (const processor of ['Cloudflare', 'Turso', 'Resend', 'Sanity', 'Twenty']) {
		await expect(
			page.getByRole('heading', { level: 3, name: processor, exact: true }),
			`${processor} processes personal data but is not named under "Where it lives" — the page ` +
				`presents that list as complete, so add it back or stop sending it data.`
		).toBeVisible();
	}
});
