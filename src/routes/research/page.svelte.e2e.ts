import { expect, test } from '@playwright/test';

// /research renders the papers index through the real worker build (SSR fetch of published papers).
// Chrome-only assertions — resilient to live content and to a transient Sanity outage (empty index).
// The lede check is DAR-52's credibility fix: the hero must no longer claim every entry as
// DarcStar work (per-entry origin chips/disclaimers are content-dependent → unit-tested instead).
test('research page renders its hero heading and origin-honest lede', async ({ page }) => {
	await page.goto('/research');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Papers');
	await expect(page.getByText('alongside the foundational third-party research')).toBeVisible();
});

// The filter bar renders whenever papers exist, and URL params SSR into the controls — so a
// filtered deep link works without JS. Facet OPTIONS are content-derived and deliberately not
// asserted; the origin/sort sets are static. Assertions scope to the form (its aria-label
// names it): the zero-match state renders a SECOND 'Clear filters' link in the message, so a
// page-wide locator would strict-mode-collide if the data ever makes this combination empty.
test('filter bar renders and SSRs the URL state into its controls', async ({ page }) => {
	await page.goto('/research?origin=external&sort=title');
	const form = page.getByRole('form', { name: 'Filter and sort papers' });
	await expect(form.getByLabel('Topic')).toBeVisible();
	await expect(form.getByLabel('Author')).toBeVisible();
	await expect(form.getByLabel('Origin')).toHaveValue('external');
	await expect(form.getByLabel('Sort by')).toHaveValue('title');
	await expect(form.getByRole('button', { name: 'Apply' })).toBeVisible();
	await expect(form.getByRole('link', { name: 'Clear filters' })).toBeVisible();
});

// The submit → URL contract, content-free (origin's option set is static): selecting an origin
// and applying must land on the filtered URL. Covers the wiring a deep-link test can't — the
// select names feeding buildFilterQuery and the submit handler.
test('applying a filter navigates to the filtered URL', async ({ page }) => {
	await page.goto('/research');
	const form = page.getByRole('form', { name: 'Filter and sort papers' });
	await form.getByLabel('Origin').selectOption('external');
	await form.getByRole('button', { name: 'Apply' }).click();
	await expect(page).toHaveURL(/\/research\?origin=external$/);
});
