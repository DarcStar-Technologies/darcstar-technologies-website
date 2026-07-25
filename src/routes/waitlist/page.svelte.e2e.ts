import { expect, test } from '@playwright/test';

// /waitlist (DAR-60) renders the v2 step-1 core signup through the Cloudflare worker build: the
// required Name + Email fields, the "Join the waitlist" submit, and the DAR-44 data-handling notice
// beside it. Scoped to <main> for consistency with the contact spec (the layout mounts the hidden
// contact modal outside <main>). Hermetic against the placeholder DB — the page has no server load,
// so it renders regardless of DB availability.
test('waitlist step-1 form renders with required fields and its data-handling notice', async ({
	page
}) => {
	await page.goto('/waitlist');

	const main = page.getByRole('main');
	await expect(
		main.getByRole('heading', { level: 1, name: 'Get early access to GIDE' })
	).toBeVisible();
	await expect(main.getByLabel('Name', { exact: true })).toBeVisible();
	await expect(main.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(main.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
	await expect(main.getByRole('link', { name: 'How we handle your data' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);
});
