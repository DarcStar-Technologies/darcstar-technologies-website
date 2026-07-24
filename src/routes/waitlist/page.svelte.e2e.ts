import { expect, test } from '@playwright/test';

// /waitlist (#127) renders the lead-capture form through the Cloudflare worker build, with the
// DAR-44 data-handling notice beside its submit. Scoped to <main> for consistency with the
// contact spec (the layout mounts the hidden contact modal outside <main>).
test('waitlist form renders with its data-handling notice', async ({ page }) => {
	await page.goto('/waitlist');

	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { level: 1, name: 'Join the waitlist' })).toBeVisible();
	await expect(main.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(main.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
	await expect(main.getByRole('link', { name: 'How we handle your data' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);
});
