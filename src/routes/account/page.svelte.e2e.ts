import { expect, test } from '@playwright/test';

// The /account portal (#96) is gated to any signed-in account. `hooks.server.ts` resolves the
// session into `locals.user` for /account, and account/+layout.server.ts redirects to /login when
// it's absent. This is the load-bearing isolation guarantee's baseline — and it's DB-free: with no
// session cookie Better Auth's getSession returns null without a query, so the redirect fires
// against the built Cloudflare worker regardless of DB reachability.
test('unauthenticated /account redirects to the login page', async ({ page }) => {
	await page.goto('/account');

	await expect(page).toHaveURL(/\/login$/);
	// The login form actually rendered (not just a bare redirect target).
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
