import { expect, test } from '@playwright/test';

// Security response headers (DAR-45), asserted through the real Cloudflare worker build. Two
// delivery paths are under test: SSR'd responses get their headers from hooks.server.ts
// (handleSecurityHeaders) + SvelteKit's `csp` config (vite.config.ts), while static assets are
// served by the Workers assets layer and get theirs from the root `_headers` file. The CSP is enforced (not
// report-only), so the violation-guard tests below double as the regression net: a new third-party
// script/image/frame that isn't allowlisted fails the suite instead of silently breaking in prod.

test('SSR page responses carry the full security header set', async ({ page }) => {
	const response = await page.goto('/');
	const headers = response!.headers();

	const csp = headers['content-security-policy'];
	expect(csp).toBeTruthy();
	expect(csp).toContain("default-src 'self'");
	// Kit appends a per-response nonce for its inline hydration bootstrap.
	expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
	expect(csp).toContain("'nonce-");
	expect(csp).toContain("style-src 'self' 'unsafe-inline'");
	expect(csp).toContain("img-src 'self' data: https://cdn.sanity.io");
	expect(csp).toContain("font-src 'self' data:");
	expect(csp).toContain('frame-src https://challenges.cloudflare.com');
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("base-uri 'self'");
	expect(csp).toContain("form-action 'self'");

	expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['permissions-policy']).toContain('camera=()');
	expect(headers['x-frame-options']).toBe('DENY');
});

// Assets bypass the worker entirely, so this catches the root `_headers` file going missing from the build
// output (the adapter copies it from the project root into .svelte-kit/cloudflare).
test('static asset responses carry nosniff + HSTS via the root `_headers` file', async ({
	request
}) => {
	const res = await request.get('/robots.txt');
	expect(res.ok()).toBe(true);
	expect(res.headers()['x-content-type-options']).toBe('nosniff');
	expect(res.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
});

// The _headers file itself must not be served as a public asset.
test('the _headers file is not publicly served', async ({ request }) => {
	const res = await request.get('/_headers');
	expect(res.status()).toBe(404);
});

declare global {
	interface Window {
		__cspViolations: string[];
	}
}

/** Collect `securitypolicyviolation` events from before the first page script runs. */
async function trackCspViolations(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		window.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (e) => {
			window.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI || 'inline'}`);
		});
	});
}

async function collectCspViolations(page: import('@playwright/test').Page) {
	// Give late loaders (Turnstile's api.js, Sanity images, the glass sheen) a beat to finish.
	await page.waitForLoadState('load');
	await page.waitForTimeout(1000);
	return page.evaluate(() => window.__cspViolations);
}

// Every public surface, rendered under the enforced CSP: the pages cover Kit's hydration bootstrap
// (script nonce), Svelte transitions + SSR'd style attributes (unsafe-inline styles), Sanity images
// (/news), and the Turnstile widget on /signup (script-src + frame-src) when a sitekey is present.
for (const path of ['/', '/about', '/news', '/research', '/people', '/signup', '/login']) {
	test(`no CSP violations on ${path}`, async ({ page }) => {
		await trackCspViolations(page);
		await page.goto(path);
		expect(await collectCspViolations(page)).toEqual([]);
	});
}

// The contact modal exercises the dialog transition path (runtime-injected <style>) on top of a
// hydrated page — the classic style-src casualty.
test('no CSP violations opening the contact modal', async ({ page }) => {
	await trackCspViolations(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Contact Us' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	expect(await collectCspViolations(page)).toEqual([]);
});
