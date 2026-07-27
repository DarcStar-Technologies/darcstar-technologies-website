import { expect, test } from '@playwright/test';

// /research renders the papers index through the real worker build (SSR fetch of published papers).
// Chrome-only assertions — resilient to live content and to a transient Sanity outage (empty index).
// The lede check is DAR-52's credibility fix: the hero must no longer claim every entry as
// DarcStar work (per-entry origin chips/disclaimers are content-dependent → unit-tested instead).
test('research page renders its hero heading and origin-honest lede', async ({ page }) => {
	await page.goto('/research');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Papers');
	await expect(page.getByText('alongside the foundational third-party research')).toBeVisible();
});

// The filter bar renders whenever papers exist, and URL params SSR into the controls — so a
// filtered deep link works without JS. Facet OPTIONS are content-derived and deliberately not
// asserted; the origin/sort sets are static. Assertions scope to the form (its aria-label
// names it): the zero-match state renders a SECOND 'Clear filters' link in the message, so a
// page-wide locator would strict-mode-collide if the data ever makes this combination empty.
//
// CI contract (test.yml, DAR-49): the e2e job runs Sanity-token-less, so the index is EMPTY
// there and the bar is deliberately gated off — the filter tests assert the empty state in
// that environment and the full contract when content exists (the route's own degradation,
// deterministic per environment — not a flaky conditional).
const FILTER_FORM = { name: 'Filter and sort papers' };

test('filter bar renders and SSRs the URL state into its controls', async ({ page }) => {
	await page.goto('/research?origin=external&sort=title');
	const form = page.getByRole('form', FILTER_FORM);
	if ((await form.count()) === 0) {
		await expect(page.getByText('No papers yet')).toBeVisible();
		return;
	}
	await expect(form.getByLabel('Topic')).toBeVisible();
	await expect(form.getByLabel('Author')).toBeVisible();
	await expect(form.getByLabel('Origin')).toHaveValue('external');
	await expect(form.getByLabel('Sort by')).toHaveValue('title');
	await expect(form.getByRole('button', { name: 'Apply' })).toBeVisible();
	await expect(form.getByRole('link', { name: 'Clear filters' })).toBeVisible();
});

// DAR-94: the Author facet is a TEXT INPUT, not a select. The author vocabulary grows ~7 people per
// paper and never plateaus (123 across 18 papers), so shipping it as <option>s would undo the point
// of paginating — suggestions come from /research/authors.json as the visitor types instead. The
// element type is the part worth pinning: a future "let's just make it a select again" is a silent
// payload regression, and this is the only guard that would notice.
test('the author facet is a text input backed by a datalist, not an option list', async ({
	page
}) => {
	await page.goto('/research');
	const form = page.getByRole('form', FILTER_FORM);
	if ((await form.count()) === 0) {
		await expect(page.getByText('No papers yet')).toBeVisible();
		return;
	}
	const author = form.getByLabel('Author');
	await expect(author).toHaveJSProperty('tagName', 'INPUT');
	await expect(author).toHaveAttribute('list', 'research-author-options');
});

// The endpoint is the type-ahead's whole mechanism, and its refusal below three characters is what
// stops it being a way to download the vocabulary the page declines to ship. Content-free on the
// refusal side, so it holds in CI where /research is empty for want of SANITY_VIEWER_TOKEN.
test('the author lookup refuses a query too short to narrow anything', async ({ request }) => {
	for (const q of ['', 'd', 'da', '*']) {
		const res = await request.get(`/research/authors.json?q=${encodeURIComponent(q)}`);
		expect(res.ok()).toBe(true);
		expect(await res.json()).toEqual({ authors: [] });
	}
	// ...and a usable query is served rather than refused, so the check above isn't just asserting a
	// dead endpoint. The RESULT is content-dependent (empty in CI), the 200 is not.
	const served = await request.get('/research/authors.json?q=dao');
	expect(served.ok()).toBe(true);
	expect(await served.json()).toHaveProperty('authors');
});

// Same rule as /news: a paged or filtered view is a view of the index, not a page of its own. Pins
// behaviour that was already true (Seo derives both tags from `page.url.pathname`, which excludes
// the query string) and that nothing else would notice breaking — it is what makes leaving these
// views out of the sitemap safe.
test('paged and filtered views canonicalise to the bare index', async ({ page }) => {
	// `?page=1`, not `?page=2`: a page past the end REDIRECTS, so on an 18-paper index (or the empty
	// one CI renders without SANITY_VIEWER_TOKEN) `?page=2` would land on a URL with no page param
	// and this would only assert that `/research` canonicalises to `/research`. Page 1 is in range
	// for any corpus, so the query string survives and the tag is genuinely under test.
	await page.goto('/research?page=1&topic=long-context&sort=title');
	await expect(page).toHaveURL(/page=1/);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/research$/);
	await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', /\/research$/);
});

// The submit → URL contract, content-free (origin's option set is static): selecting an origin
// and applying must land on the filtered URL. Covers the wiring a deep-link test can't — the
// select names feeding buildFilterQuery and the submit handler.
test('applying a filter navigates to the filtered URL', async ({ page }) => {
	await page.goto('/research');
	const form = page.getByRole('form', FILTER_FORM);
	if ((await form.count()) === 0) {
		await expect(page.getByText('No papers yet')).toBeVisible();
		return;
	}
	await form.getByLabel('Origin').selectOption('external');
	await form.getByRole('button', { name: 'Apply' }).click();
	await expect(page).toHaveURL(/\/research\?origin=external$/);
});
