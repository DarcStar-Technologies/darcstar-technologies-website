import { expect, test, type Page } from '@playwright/test';
import { THEOREMS_CHECKED, THEOREMS_COMPLETE } from '$lib/evidence';
import { findCatalogTotalLeaks } from '$lib/evidence-boundary';

// The catalog total must not reach a RENDERED page (DAR-152). The unit spec scans the message
// catalogs and the $lib/evidence constants — every source the copy is supposed to come from —
// so this is the backstop for a figure that arrives some other way: hardcoded into a .svelte,
// or served from the CMS.
//
// Scanned LINE BY LINE, not as one blob. innerText breaks at block boundaries, and the detector
// tests whether a number sits near theorem wording — which is a claim about prose. Rendered text
// is a concatenation of unrelated elements, so a whole-page scan reads the homepage's `13,000×`
// readout as neighbouring the theorems readout beside it and reports a leak that no sentence
// contains. One line ≈ one block ≈ one claim. The cost is that a leak split across two elements
// is missed here; the unit spec still sees it at the source.
const expectNoCatalogTotal = async (page: Page) => {
	const lines = (await page.locator('body').innerText()).split('\n');
	const leaks = lines.flatMap((line) => findCatalogTotalLeaks(line, THEOREMS_CHECKED));
	expect(leaks, `${page.url()} must not publish the catalog total`).toEqual([]);
};

// /evidence (DAR-43) — static content page (no Sanity, no DB), so unlike the content-feed
// specs this needs no degradation guard: the full surface must render in every environment.
test('evidence page renders the hero, the claim cards, and the IP boundary', async ({ page }) => {
	await page.goto('/evidence');

	await expect(page.getByRole('heading', { level: 1 })).toContainText('Claims you can');

	// One heading per claim card — the h2 set is the page's contract with the homepage claims.
	await expect(page.getByRole('heading', { name: 'CfC kernel inference' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Faster than real time' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Theorems machine-checked' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Formal safety guarantees' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Domains shipped' })).toBeVisible();

	// The load-bearing honesty content: the machine-checked count (the card's headline figure
	// AND its prose — both flow from $lib/evidence.ts, so this pins the constants end-to-end)
	// and the IP boundary. The catalog total / remainder is deliberately NOT published — assert
	// its absence so it can't quietly come back.
	await expect(page.getByText(String(THEOREMS_CHECKED), { exact: true })).toBeVisible();
	await expect(page.getByText(`${THEOREMS_CHECKED} theorems in the GIDE framework`)).toBeVisible();
	await expectNoCatalogTotal(page);
	await expect(page.getByText('parameter')).toHaveCount(0);
	await expect(
		page.getByRole('heading', { name: 'What we deliberately do not publish' })
	).toBeVisible();

	// Each stat card links to its detail page (the benchmarks link rides on both latency cards).
	await expect(page.getByRole('link', { name: 'Hardware runs & full methodology' })).toHaveCount(2);
	await expect(page.getByRole('link', { name: 'What machine-checked means' })).toBeVisible();
});

// The run-level benchmark detail lives on its own page: per-run figures, environment (including
// the logged attribution gap), and the deployed-controller latency — with no exact architecture
// numbers (no hidden-dim, no parameter count) anywhere.
test('benchmarks detail page carries the hardware runs', async ({ page }) => {
	await page.goto('/evidence/benchmarks');

	await expect(page.getByRole('heading', { level: 1 })).toContainText('Measured on real');
	await expect(page.getByText('0.767 µs', { exact: true })).toBeVisible();
	await expect(page.getByText('Neoverse-N2')).toBeVisible();
	await expect(page.getByText('0.81 and 0.91 µs')).toBeVisible();
	// The whole-controller figure — the number this page exists to carry (the copy calls it
	// "the figure to cite"); its absence must fail, not just the kernel figures'.
	await expect(page.getByText('52 µs p50')).toBeVisible();
	await expect(page.getByText('parameter')).toHaveCount(0);
	await expectNoCatalogTotal(page);
});

// The card → detail-page hops, actually clicked: link-name presence can't catch a
// fat-fingered `more.href`, and a direct goto exercises the page but never the link.
test('card links navigate to their detail pages', async ({ page }) => {
	await page.goto('/evidence');
	await page.getByRole('link', { name: 'What machine-checked means' }).click();
	await expect(page).toHaveURL(/\/evidence\/proofs$/);

	await page.goto('/evidence');
	await page.getByRole('link', { name: 'Hardware runs & full methodology' }).first().click();
	await expect(page).toHaveURL(/\/evidence\/benchmarks$/);
});

// The proof-methodology detail page defines "machine-checked" (complete vs axiom-backed),
// names the provers, and — like the card it backs — never mentions the catalog total or the
// not-yet-mechanized remainder.
test('proofs detail page defines machine-checked without the backlog', async ({ page }) => {
	await page.goto('/evidence/proofs');

	await expect(page.getByRole('heading', { level: 1 })).toContainText('What machine-checked');
	await expect(page.getByText('Isabelle2025-2')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What counts as proven' })).toBeVisible();
	await expectNoCatalogTotal(page);

	// DAR-117's second half: the page separates a theorem's declared hypotheses from the local
	// axioms that keep it out of the complete count. The three item headings ARE the distinction,
	// so losing any one of them collapses the two ideas the section exists to keep apart.
	await expect(page.getByRole('heading', { name: 'Assumptions vs. local axioms' })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Assumptions the theorems are stated under' })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Local axioms inside the proofs' })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Physical premises carried as hypotheses' })
	).toBeVisible();
});

// The nested pages carry Home → Evidence → self breadcrumbs (DAR-48's builder) — the site's
// first static routes with a parent, so the hierarchy must reach search results.
test('detail pages emit breadcrumb structured data', async ({ page }) => {
	for (const [path, leaf] of [
		['/evidence/benchmarks', 'Benchmarks'],
		['/evidence/proofs', 'Proof methodology']
	]) {
		await page.goto(path);
		const graphs = await page.locator('script[type="application/ld+json"]').allTextContents();
		const crumbs = graphs
			.map((raw) => JSON.parse(raw))
			.flatMap((node) => (Array.isArray(node['@graph']) ? node['@graph'] : [node]))
			.find((node) => node['@type'] === 'BreadcrumbList');
		expect(crumbs, `${path} should carry a BreadcrumbList`).toBeTruthy();
		expect(crumbs.itemListElement.map((item: { name: string }) => item.name)).toEqual([
			'Home',
			'Evidence',
			leaf
		]);
	}
});

// The DAR-43 complaint was "no path from claim to evidence" — pin the path: the homepage stats
// row shows a real, qualified theorem figure (not the old Layer-1 "150", which was a catalog size
// rather than a proven count) and links through to /evidence.
//
// Which figure leads is DAR-117, and this is the ONLY place that can see it: the readout renders
// a constant, so swapping THEOREMS_COMPLETE back to THEOREMS_CHECKED type-checks, keeps every
// unit spec green, and quietly restores the bare total in the largest type on the site. The
// standalone-total assertion is the one that catches it — after the change the checked count
// appears only inside the qualifying label, never as a headline value of its own.
test('homepage stats row leads with the complete count and links to the evidence page', async ({
	page
}) => {
	await page.goto('/');

	await expect(page.getByText(String(THEOREMS_COMPLETE), { exact: true })).toBeVisible();
	await expect(
		page.getByText(`theorems complete of ${THEOREMS_CHECKED} machine-checked`)
	).toBeVisible();
	await expect(page.getByText(String(THEOREMS_CHECKED), { exact: true })).toHaveCount(0);
	await expectNoCatalogTotal(page);
	await page.getByRole('link', { name: 'How we verify these numbers' }).click();

	await expect(page).toHaveURL(/\/evidence$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Claims you can');
});
