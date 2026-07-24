import { expect, test } from '@playwright/test';

// The /admin area (#69) is gated by Better Auth. `hooks.server.ts` resolves the session into
// `locals.user` for /admin, and admin/+layout.server.ts redirects to /login when it's absent.
// This is the acceptance's required case — and it's DB-free: with no session cookie Better Auth's
// getSession returns null without a query, so the redirect fires against the built Cloudflare
// worker regardless of DB reachability.
test('unauthenticated /admin redirects to the login page', async ({ page }) => {
	await page.goto('/admin');

	await expect(page).toHaveURL(/\/login$/);
	// The login form actually rendered (not just a bare redirect target). Scope to the page's own
	// glass-card — the one holding the h1 — because page-wide label queries strict-mode-collide
	// with the rest of the layout: the ContactDialog keeps a hidden "Email" field in the DOM while
	// closed, and the footer has a visible aria-label="Email" mail link. Scoping (rather than
	// role-filtering) keeps getByLabel's real assertion: the inputs are named by an associated
	// label, not a placeholder fallback.
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
	const loginCard = page
		.locator('.glass-card')
		.filter({ has: page.getByRole('heading', { level: 1, name: 'Sign in' }) });
	await expect(loginCard.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(loginCard.getByLabel('Password', { exact: true })).toBeVisible();
	await expect(loginCard.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

// Public sign-up stays closed (auth-options.ts #48, unit-tested in auth.spec.ts) — the login page
// offers no path to account creation. Visiting /login directly just shows the sign-in form.
test('the login page renders its sign-in form', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
