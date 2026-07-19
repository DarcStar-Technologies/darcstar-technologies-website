import { expect, test } from '@playwright/test';

// The /admin area (#69) is gated by Better Auth. `hooks.server.ts` resolves the session into
// `locals.user` for /admin, and admin/+layout.server.ts redirects to /login when it's absent.
// This is the acceptance's required case — and it's DB-free: with no session cookie Better Auth's
// getSession returns null without a query, so the redirect fires against the built Cloudflare
// worker regardless of DB reachability.
test('unauthenticated /admin redirects to the login page', async ({ page }) => {
	await page.goto('/admin');

	await expect(page).toHaveURL(/\/login$/);
	// The login form actually rendered (not just a bare redirect target).
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
	await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

// Public sign-up stays closed (auth-options.ts #48, unit-tested in auth.spec.ts) — the login page
// offers no path to account creation. Visiting /login directly just shows the sign-in form.
test('the login page renders its sign-in form', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
