import { expect, test } from '@playwright/test';

// Public sign-up (#96 PR 2) is reachable by anyone — unlike /account, an anonymous visitor is NOT
// bounced to /login; the whole point is to let a new visitor register. The captcha widget doesn't
// render in the preview (no TURNSTILE_SITE_KEY), so this asserts the surrounding form is served, not
// the challenge. DB-free: rendering the page runs no query.
test('anonymous /signup renders the sign-up form (no redirect)', async ({ page }) => {
	await page.goto('/signup');

	await expect(page).toHaveURL(/\/signup$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
	// The cross-link back to sign-in is present. Scope to its prompt paragraph — the navbar also has a
	// "Sign in" link, so a bare getByRole('link', { name: 'Sign in' }) would be a strict-mode conflict.
	await expect(page.getByText('Already have an account?')).toBeVisible();

	// Agreement notice (DAR-44): creating an account links both legal pages.
	await expect(page.getByRole('link', { name: 'terms of service' })).toHaveAttribute(
		'href',
		/\/terms$/
	);
	await expect(page.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
		'href',
		/\/privacy$/
	);
});
