import { expect, test } from '@playwright/test';

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
	await expect(page.getByText('219', { exact: true })).toBeVisible();
	await expect(page.getByText('219 theorems in the GIDE framework')).toBeVisible();
	await expect(page.getByText('338')).toHaveCount(0);
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
	await expect(page.getByText('parameters')).toHaveCount(0);
});

// The proof-methodology detail page defines "machine-checked" (complete vs axiom-backed),
// names the provers, and — like the card it backs — never mentions the catalog total or the
// not-yet-mechanized remainder.
test('proofs detail page defines machine-checked without the backlog', async ({ page }) => {
	await page.goto('/evidence/proofs');

	await expect(page.getByRole('heading', { level: 1 })).toContainText('What machine-checked');
	await expect(page.getByText('Isabelle2025-2')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What counts as proven' })).toBeVisible();
	await expect(page.getByText('338')).toHaveCount(0);
});

// The DAR-43 complaint was "no path from claim to evidence" — pin the path: the homepage
// stats row shows the corrected machine-checked count (219, NOT the old Layer-1 "150" —
// the readout renders THEOREMS_CHECKED from $lib/evidence.ts) and links through to /evidence.
test('homepage stats row links through to the evidence page', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByText('219', { exact: true })).toBeVisible();
	await expect(page.getByText('theorems machine-checked')).toBeVisible();
	await page.getByRole('link', { name: 'How we verify these numbers' }).click();

	await expect(page).toHaveURL(/\/evidence$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Claims you can');
});
