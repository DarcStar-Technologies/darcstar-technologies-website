import { expect, test } from '@playwright/test';

// Homepage smoke test: the marketing page renders end-to-end (through the real
// Cloudflare worker build) with its hero, a downstage section, and the CTAs.
test('homepage renders the hero, a section and the CTAs', async ({ page }) => {
	await page.goto('/');

	// Brand in the header
	await expect(page.getByRole('banner')).toContainText('DarcStar');

	// Hero headline
	const h1 = page.getByRole('heading', { level: 1 });
	await expect(h1).toContainText('Autonomous control');
	await expect(h1).toContainText('is safe.');

	// A below-the-fold section + the telemetry readout render
	await expect(
		page.getByRole('heading', { name: 'Verified against stated assumptions.' })
	).toBeVisible();
	await expect(page.getByText('CfC inference')).toBeVisible();

	// Primary CTAs — "Explore GIDE" is an in-page anchor; "Contact Us" now opens the
	// contact modal, so it's a button (issue #11).
	await expect(page.getByRole('link', { name: 'Explore GIDE' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Contact Us' })).toBeVisible();
});

// DAR-46: the domain count is the one homepage figure a reader can't interpret on its own —
// the review read "five domains shipped" as possibly meaning customer deployments. The label
// now says what it counts, and the definition renders with the list it describes, naming the
// two readings it is NOT. (The theorems readout is pinned over in evidence/page.svelte.e2e.ts,
// which asserts the homepage stats row and its click-through to /evidence.)
test('the domain count says what it counts, and shipped is defined on the page', async ({
	page
}) => {
	await page.goto('/');

	await expect(page.getByText('domains running end-to-end')).toBeVisible();
	await expect(page.getByText('not a demo, and not a customer deployment')).toBeVisible();
});

// DAR-46: the real-time pillar used to hardcode both figures in its prose — the one string that
// broke docs/evidence.md's "never re-inline a figure" rule, so a re-measure would have moved the
// readouts and left the pillar stale. It now takes them as message params from $lib/evidence, and
// this asserts they RENDER (a wrong/missing param name compiles fine and prints the placeholder).
test('the real-time pillar renders its figures from the shared evidence source', async ({
	page
}) => {
	await page.goto('/');

	await expect(
		page.getByText('the reference kernel measures 0.767 µs per forward pass')
	).toBeVisible();
	await expect(page.getByText('13,000× inside a 100 Hz control budget')).toBeVisible();
});

// The header About link now navigates to the real /about page (issue #61); the old
// in-page #about footer anchor and its smooth-scroll enhancement were retired.
test('header About link navigates to the about page', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('link', { name: 'About' }).click();

	await expect(page).toHaveURL(/\/about$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'safety for autonomous systems'
	);
});

// Regression: the glass sheen light-plane lives in the persistent layout, so its clip-path
// (the union of the CURRENT route's glass panels) must be rebuilt on client-side navigation.
// Before the afterNavigate re-clip, the beam stayed pinned to the previous page's panels — a
// ghost that only realigned after a scroll or refresh. Here the clip must change to the about
// page's (fewer, differently-placed) panels with NO scroll (the user's old workaround).
test('the glass sheen clip-path is rebuilt on navigation (no ghost of the prior page)', async ({
	page
}) => {
	await page.goto('/');

	const clipPath = () =>
		page.evaluate(() => document.querySelector<HTMLElement>('.sheen-plane')?.style.clipPath ?? '');

	// The clip is applied an rAF after load; wait for it, then capture the homepage geometry.
	await expect.poll(clipPath).not.toBe('');
	const homeClip = await clipPath();

	// SPA navigation (link click, not a reload) to a page whose panels differ from home's.
	await page.getByRole('link', { name: 'About' }).click();
	await expect(page).toHaveURL(/\/about$/);

	// Without the fix this stays === homeClip forever (poll would time out); with it, the clip
	// rebuilds to the about page's panels promptly and with no scroll.
	await expect.poll(clipPath).not.toBe(homeClip);
});

// The contact modal (issue #11) opens from the CTA, shows its fields, and closes on
// Esc. The happy-path submit (which writes to Turso) is verified manually, not here —
// validation itself is covered by src/lib/server/contact.spec.ts.
test('contact modal opens from the CTA and closes on Escape', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: 'Contact Us' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();

	await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('Message', { exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Send message' })).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(dialog).not.toBeVisible();
});
