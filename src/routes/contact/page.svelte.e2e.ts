import { expect, test } from '@playwright/test';

// The standalone /contact page (issue #55) is the no-JS fallback for the contact modal.
// It renders the SAME remote form (submitContact), so it must work both with and without
// JavaScript. Selectors are scoped to <main>: the global ContactDialog (rendered in the
// layout) keeps its own copy of the contact form mounted-but-hidden and portaled outside
// <main>, so an unscoped `form`/`getByLabel` would match both. The happy-path submit
// (which writes to Turso) stays a manual check — see src/lib/server/contact.spec.ts for
// the validation coverage.
test('/contact renders the contact form with all fields', async ({ page }) => {
	await page.goto('/contact');

	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { level: 1, name: 'Get in touch' })).toBeVisible();
	await expect(main.getByLabel('Name', { exact: true })).toBeVisible();
	await expect(main.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(main.getByLabel('Area of interest')).toBeVisible();
	await expect(main.getByLabel('Message', { exact: true })).toBeVisible();
	await expect(main.getByRole('button', { name: 'Send message' })).toBeVisible();
});

// Without JavaScript the page must still submit: the remote form degrades to a native
// POST. We verify the form carries method/action (the native-submit contract) and the
// fields render — without actually submitting (that would write to the production DB).
test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('/contact form falls back to a native POST', async ({ page }) => {
		await page.goto('/contact');

		const form = page.getByRole('main').locator('form');
		await expect(form).toHaveAttribute('method', /post/i);
		await expect(form).toHaveAttribute('action', /submitContact/);

		const main = page.getByRole('main');
		await expect(main.getByLabel('Name', { exact: true })).toBeVisible();
		await expect(main.getByLabel('Message', { exact: true })).toBeVisible();
		await expect(main.getByRole('button', { name: 'Send message' })).toBeVisible();
	});
});
