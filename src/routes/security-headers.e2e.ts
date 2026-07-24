import { expect, test, type Page } from '@playwright/test';

// Security response headers (DAR-45), asserted through the real Cloudflare worker build. Two
// delivery paths are under test: worker responses get their headers from hooks.server.ts
// (handleSecurityHeaders) + SvelteKit's `csp` config (vite.config.ts), while static assets are
// served by the Workers assets layer and get theirs (nosniff + HSTS only) from the root `_headers`
// file. The CSP is enforced (not report-only), so the violation-guard tests below are the
// regression net. `pnpm preview` bakes Cloudflare's universal always-pass Turnstile TEST keys
// (package.json) — a real sitekey rejects localhost before ever iframing — so the live widget
// mounts here and the challenges.cloudflare.com allowlist is exercised end-to-end; the synthetic
// probes below cover the third-party allowlist even without env-dependent content.

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

// Assets bypass the worker entirely, so this catches the root `_headers` file going missing from
// the build output (the adapter copies it from the project root into .svelte-kit/cloudflare).
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

// --- CSP violation guard -------------------------------------------------------------------

/** Register a collector for `securitypolicyviolation` events before any page script runs. */
async function trackCspViolations(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { __cspViolations: string[] };
		w.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (e) => {
			w.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI || 'inline'}`);
		});
	});
}

function readCspViolations(page: Page) {
	return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

/** Best-effort settle: violations fire at request-ATTEMPT time, so once the network goes quiet,
 * every loader that was going to run has already either loaded or violated. Never fails a test on
 * its own — per-page `ready` waits are the deterministic part. */
async function settle(page: Page) {
	await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

// Every public surface, rendered under the enforced CSP: Kit's hydration bootstrap (script
// nonce), Svelte transitions + SSR'd style attributes ('unsafe-inline' styles), the localized
// /es tree (paraglide reroute + transformPageChunk), and the live Turnstile widget on /signup.
// Each test also asserts the worker header set arrived — a page that starts prerendering moves to
// the assets layer, silently losing these headers (and frame-ancestors), and fails here.
const AUDITED_PAGES: { path: string; ready?: (page: Page) => Promise<void> }[] = [
	{ path: '/' },
	{ path: '/es' },
	{ path: '/about' },
	{ path: '/news' },
	{ path: '/research' },
	{ path: '/people' },
	{ path: '/contact' },
	{ path: '/waitlist' },
	{ path: '/forgot-password' },
	{ path: '/login' },
	{
		path: '/signup',
		// The preview's always-pass TEST sitekey mounts the real widget on any host, exercising
		// script-src + the challenge platform live. Turnstile hides its iframe inside a CLOSED
		// shadow root (invisible to selectors), so the deterministic "widget ran" signal is the
		// hidden token input `turnstile.render()` injects into the form.
		ready: (page) =>
			page.locator('input[name="cf-turnstile-response"]').first().waitFor({ state: 'attached' })
	}
];

for (const { path, ready } of AUDITED_PAGES) {
	test(`no CSP violations on ${path}`, async ({ page }) => {
		await trackCspViolations(page);
		const response = await page.goto(path);
		expect(response!.headers()['x-frame-options']).toBe('DENY');
		if (ready) await ready(page);
		await settle(page);
		expect(await readCspViolations(page)).toEqual([]);
	});
}

// The contact modal exercises the dialog transition path (runtime-injected <style>) on top of a
// hydrated page — the classic style-src casualty.
test('no CSP violations opening the contact modal', async ({ page }) => {
	await trackCspViolations(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Contact Us' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await settle(page);
	expect(await readCspViolations(page)).toEqual([]);
});

// Deterministic allowlist probes, independent of env/tokens: a CSP block fires the violation
// event at request-attempt time, BEFORE any network I/O, so even a 404 target proves the
// directive allows the origin. This keeps img-src guarded when the preview has no Sanity content
// and frame-src guarded without relying on the widget's own lifecycle.
test('allowlisted third-party origins pass the CSP (synthetic probes)', async ({ page }) => {
	await trackCspViolations(page);
	await page.goto('/');
	await page.evaluate(() => {
		const script = document.createElement('script');
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
		document.head.appendChild(script);
		const frame = document.createElement('iframe');
		frame.src = 'https://challenges.cloudflare.com/';
		document.body.appendChild(frame);
		new Image().src = 'https://cdn.sanity.io/images/8v6ikhvv/production/csp-probe.png';
	});
	await settle(page);
	expect(await readCspViolations(page)).toEqual([]);
});

// Machinery self-check: a non-allowlisted origin MUST surface as a captured violation. Guards
// against the collector breaking (or a directive accidentally widening) and every guard test
// above passing vacuously. `.invalid` never resolves, but the CSP check runs before DNS.
test('the violation guard captures a blocked origin (negative control)', async ({ page }) => {
	await trackCspViolations(page);
	await page.goto('/');
	await page.evaluate(() => {
		const script = document.createElement('script');
		script.src = 'https://not-allowlisted.invalid/probe.js';
		document.head.appendChild(script);
	});
	await expect
		.poll(async () => (await readCspViolations(page)).join('\n'))
		.toContain('not-allowlisted.invalid');
});
