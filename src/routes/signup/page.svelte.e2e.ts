import { expect, test } from '@playwright/test';

// /signup after DAR-67 closed public registration: the route survives (bookmarks and old links must
// land on an explanation, not a 404) but it is now a notice, not a form. DB-free — rendering it runs
// no query and it has no actions at all.
test('anonymous /signup renders the invite-only notice, not a sign-up form', async ({ page }) => {
	await page.goto('/signup');

	// Still reachable by anyone: an anonymous visitor is NOT bounced to /login. Being told "invite
	// only" is the whole service this page provides, and it can't provide it from behind a gate.
	await expect(page).toHaveURL(/\/signup$/);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Access is invite-only' })
	).toBeVisible();

	// The waitlist is the only route to an account now, so the page has to name it — and it must opt
	// out of the body-wide hover prefetch, or every visit to this page risks a phantom
	// `waitlist_viewed` in the funnel (DAR-66).
	const cta = page.getByRole('link', { name: 'Join the waitlist' });
	await expect(cta).toHaveAttribute('href', /\/waitlist$/);
	await expect(cta).toHaveAttribute('data-sveltekit-preload-data', 'tap');

	// Someone with an account still has somewhere to go. Scoped to its prompt paragraph — the navbar
	// also has a "Sign in" link, so a bare getByRole would be a strict-mode conflict.
	await expect(page.getByText('Already have an account?')).toBeVisible();

	// The form is GONE, not hidden: no credential fields, nothing to submit, no Turnstile widget.
	// (The widget's departure is why security-headers.e2e.ts no longer waits on one here.)
	//
	// Scoped to <main>, because the LAYOUT legitimately carries a form on every page: Skeleton keeps
	// the contact dialog's content mounted while it's closed. A page-wide `form` count would fail here
	// for a reason that has nothing to do with sign-up.
	const main = page.getByRole('main');
	await expect(main.locator('input[type="password"]')).toHaveCount(0);
	await expect(main.locator('form')).toHaveCount(0);
	await expect(main.locator('input[name="cf-turnstile-response"]')).toHaveCount(0);
});

// Belt and braces on the acceptance criterion "a direct sign-up POST is rejected".
//
// READ THIS BEFORE TRUSTING IT. In the preview, better-auth's `isAuthPath` compares the request
// origin against the configured baseURL (ORIGIN = the production host, while the preview serves
// localhost), so the auth API is not mounted here at all and this POST 404s in SvelteKit's router
// — BEFORE `disableSignUp` is ever consulted. So this test would stay green even if registration
// were re-opened, and it is NOT the guard for that.
//
// THE REAL GUARD IS `auth.spec.ts` ("our config refuses public sign-up outright"), which drives the
// very `emailAndPassword` object auth.ts ships against a throwaway instance and asserts the
// rejection. What this adds is the end-to-end fact that nothing on the deployed worker answers a
// sign-up POST with an account: no success, and above all no session.
test('a direct POST to the sign-up endpoint creates no session', async ({ request }) => {
	const res = await request.post('/api/auth/sign-up/email', {
		data: { name: 'Probe', email: 'probe@example.com', password: 'a-long-enough-password' },
		failOnStatusCode: false
	});

	expect(res.ok()).toBe(false);
	const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
	expect(cookies.some((h) => h.value.includes('session_token'))).toBe(false);
});
