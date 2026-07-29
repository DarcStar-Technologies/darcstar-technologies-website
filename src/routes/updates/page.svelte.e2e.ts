import { expect, test } from '@playwright/test';

// DAR-139's two emailed-link landing pages, driven through the real Cloudflare worker build.
//
// WHAT THIS SUITE CAN AND CANNOT SEE, stated up front because the gap is structural rather than an
// omission. CI is hermetic: there is no `BETTER_AUTH_SECRET` in the preview environment, so
// `waitlistSigningSecret()` comes back undefined and EVERY token — including a well-formed one —
// resolves to `invalid`. There is also no reachable database. So the confirmed / opted-out paths are
// unreachable here by construction, and the composition that exercises them is `pnpm smoke:waitlist`,
// which runs by hand against a real DB (DAR-103's whole reason for existing).
//
// What is left is worth having and is exactly what these assert: the generic-failure panel that every
// broken link falls into, the noindex that keeps a token-bearing URL out of the index, and the two
// negative properties that matter most — a GET offers a form and mutates nothing, and a POST with no
// usable token neither 500s nor claims success.
//
// Matched on APOSTROPHE-FREE fragments throughout. The copy is full of them ("This link didn't work",
// "You're confirmed"), Svelte escapes them in attributes but not in text, and a regex that guesses
// wrong about which passes vacuously against a page that says the opposite.

const INVALID = /may have expired/i;

const PAGES = [
	{
		path: '/updates/confirm',
		name: 'confirm',
		// From updates_confirm_done_body — the one sentence on the success panel with no apostrophe in
		// it, and the one whose appearance here would be the worst possible false positive: consent
		// reported as recorded when the token was never valid.
		success: /works without signing in/i
	},
	{
		path: '/updates/unsubscribe',
		name: 'unsubscribe',
		// From updates_unsubscribe_done_body.
		success: /place on the early-access waitlist is unaffected/i
	}
] as const;

for (const { path, name, success } of PAGES) {
	test(`${name}: a link with no token renders the generic failure panel`, async ({ page }) => {
		const response = await page.goto(path);
		expect(response?.status()).toBe(200);
		// One panel for absent / malformed / expired / wrong-page / deleted-lead — the anti-oracle rule
		// the continuation token set. Asserted on the visible copy rather than a status code, because
		// every one of those cases is a 200 by design.
		await expect(page.getByText(INVALID)).toBeVisible();
	});

	test(`${name}: an unreadable token gets the same panel, not a hint about why`, async ({
		page
	}) => {
		await page.goto(`${path}?token=c1.not-a-real-lead.9999999999.bm90YW1hYw`);
		await expect(page.getByText(INVALID)).toBeVisible();
	});

	test(`${name}: stays out of the index`, async ({ page }) => {
		await page.goto(path);
		// A page whose only useful arrival carries a one-off token has nothing to offer a crawler.
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});

	// THE PROPERTY THE WHOLE DESIGN RESTS ON. Mail scanners and link previewers fetch every URL in an
	// inbound message, so a state change that happened on GET would be made by a machine on delivery —
	// double opt-in that verifies nothing. Nothing here is reachable without a POST, and the failure
	// panel does not even render a form.
	test(`${name}: fetching the page changes nothing — the only mutation is behind a form`, async ({
		page
	}) => {
		await page.goto(path);
		await expect(page.getByText(INVALID)).toBeVisible();
		expect(await page.locator('form[method="post"]').count()).toBe(0);
		expect(await page.getByText(success).count()).toBe(0);
	});

	test(`${name}: a POST with no usable token fails visibly rather than silently succeeding`, async ({
		request
	}) => {
		// Straight at the action, the way a script would. `accept: text/html` matters — without it
		// SvelteKit answers a form action with its ActionResult envelope (HTTP 200 carrying the real
		// status in the body), so `status()` would read 200 for a refusal and a success alike.
		const response = await request.post(path, {
			headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
			data: 'token=nonsense'
		});
		expect(response.status()).toBe(200);
		const body = await response.text();
		expect(body).toMatch(INVALID);
		expect(body).not.toMatch(success);
	});
}
