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

	// The interest picker's chevron is a CSS-only affordance (appearance:none + a
	// background SVG), so it renders without JS. Confirm the native control is stripped;
	// the same CSS applies whether or not JS runs.
	await expect(main.getByLabel('Area of interest')).toHaveCSS('appearance', 'none');
});

// Regression — the "contact form on mobile acts like there's no JS" report. The global
// ContactDialog is mounted on every page (via +layout.svelte) and binds the same
// `submitContact` remote singleton; /contact ALSO renders its own <form> for that
// singleton. A remote form object can only progressively-enhance ONE <form>, so the two
// collided ("A form object can only be attached to a single `<form>` element") and the
// /contact form lost its enhancement — silently degrading to a native full-page POST
// (what a user reads as "it reloaded / opened a new page"). The modal now uses an
// isolated `.for('modal')` instance. Assert /contact submits INLINE (enhanced), with no
// full navigation and no such runtime error.
test('/contact form enhances — submits inline without the duplicate-instance error', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/contact');

	const main = page.getByRole('main');
	// Submit with ONLY the off-screen honeypot filled: the server accepts-but-does-not-persist
	// before any validation or DB write, so this drives the real enhanced-submit path without
	// touching the shared Turso DB. Belt-and-braces — if that short-circuit ever regressed, the
	// empty visible fields would fail server validation, so this test can never write a row.
	await main.locator('input[name="website"]').fill('bot', { force: true });

	await main.getByRole('button', { name: 'Send message' }).click();

	// Enhanced submit resolves inline: the success panel replaces the form and the URL never
	// navigates to the raw `?/remote=…` action (that navigation IS the un-enhanced fallback —
	// the bug this guards against), and the duplicate-attach error must not appear.
	await expect(main.getByText('Message sent')).toBeVisible();
	await expect(page).toHaveURL(/\/contact$/);
	expect(errors.filter((m) => /attached to a single/i.test(m))).toEqual([]);
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
