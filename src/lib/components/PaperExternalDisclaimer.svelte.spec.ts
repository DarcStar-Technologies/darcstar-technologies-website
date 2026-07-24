import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PaperExternalDisclaimer from './PaperExternalDisclaimer.svelte';

// The disclaimer is DAR-52's load-bearing not-ours statement, so its polarity gets the same
// rail as PaperOrigin's chips: external AND unset flags must render it; only an explicitly
// first-party paper may omit it. (Page-level tests would multi-match once several external
// papers exist — the component renders in isolation here, so getByText stays unambiguous.)

const DISCLAIMER = 'This is third-party work — not authored by or affiliated with DarcStar';

describe('PaperExternalDisclaimer', () => {
	it('renders the disclaimer for an external paper', async () => {
		render(PaperExternalDisclaimer, { darcstarAuthored: false });
		await expect.element(page.getByText(DISCLAIMER)).toBeVisible();
	});

	it('treats an unset flag as external (fail-safe direction)', async () => {
		render(PaperExternalDisclaimer, { darcstarAuthored: null });
		await expect.element(page.getByText(DISCLAIMER)).toBeVisible();
	});

	it('renders nothing for a first-party paper', () => {
		const { container } = render(PaperExternalDisclaimer, { darcstarAuthored: true });
		expect(container.textContent?.trim() ?? '').toBe('');
	});
});
