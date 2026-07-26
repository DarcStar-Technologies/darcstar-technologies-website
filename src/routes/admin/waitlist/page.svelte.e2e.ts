import { expect, test } from '@playwright/test';

// /admin/waitlist is the staff triage view, nested under the /admin guard. DAR-65 added an internal
// lead classification to it, so the access rule is now also a DISCLOSURE rule: the priority bands and
// the qualification answers behind them are staff-only, and nothing about them may render for an
// anonymous visitor.
//
// This is the DB-free acceptance case, in the same shape as the /admin and /admin/users guards: with
// no session cookie Better Auth's getSession returns null without a query, so the redirect fires
// against the built Cloudflare worker regardless of DB reachability. The rendering of the badges
// themselves is pinned in WaitlistLeadClassBadge.svelte.spec.ts, where a fixture is a prop — this
// suite has neither a session nor a reachable database to seed.
test('unauthenticated /admin/waitlist redirects to the login page', async ({ page }) => {
	const response = await page.goto('/admin/waitlist');

	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

	// Nothing from the triage view leaked into the redirect target. Assert the response exists first,
	// or a null response would make the two absence checks pass vacuously.
	expect(response).not.toBeNull();
	const body = await response!.text();
	expect(body).not.toContain('Priority A');
	expect(body).not.toContain('Qualification detail');
});

// The filter is a plain GET query, so a crafted `?class=` reaches the guard before it reaches the
// load — the redirect must not depend on the query string being well-formed.
test('a class filter on /admin/waitlist still redirects when signed out', async ({ page }) => {
	await page.goto('/admin/waitlist?class=priority-a');

	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
