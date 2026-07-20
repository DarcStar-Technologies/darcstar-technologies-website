import { expect, test } from '@playwright/test';

// /admin/users (operator-roster management) is admin-only and nested under the /admin guard. This
// is the DB-free acceptance case: with no session cookie the parent /admin guard's getSession
// returns null without a query, so an unauthenticated visitor is redirected to /login against the
// built Cloudflare worker regardless of DB reachability — same shape as the /admin guard e2e.
//
// The signed-in-but-non-admin → /admin redirect (admin/users/+layout.server.ts) needs a real
// session, so it's exercised by the sign-in smoke instead (scripts/smoke-signin.mjs).
test('unauthenticated /admin/users redirects to the login page', async ({ page }) => {
	await page.goto('/admin/users');

	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
