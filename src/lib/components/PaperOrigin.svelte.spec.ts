import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PaperOrigin from './PaperOrigin.svelte';

// The origin chips are the rail that keeps third-party papers from reading as DarcStar work
// (DAR-52), so the polarity is load-bearing: external AND unset flags must mark the entry,
// and only an explicitly first-party paper may render unmarked.

describe('PaperOrigin', () => {
	it('marks an external paper with the third-party chip', async () => {
		render(PaperOrigin, { darcstarAuthored: false });
		await expect.element(page.getByText('Third-party')).toBeVisible();
	});

	it('treats an unset flag as external (fail-safe direction)', async () => {
		render(PaperOrigin, { darcstarAuthored: null });
		await expect.element(page.getByText('Third-party')).toBeVisible();
	});

	it('adds the commentary chip for an annotated external paper', async () => {
		render(PaperOrigin, { darcstarAuthored: false, hasCommentary: true });
		await expect.element(page.getByText('Third-party')).toBeVisible();
		await expect.element(page.getByText('DarcStar commentary')).toBeVisible();
	});

	it('renders nothing for a first-party paper', () => {
		const { container } = render(PaperOrigin, { darcstarAuthored: true, hasCommentary: true });
		expect(container.textContent?.trim() ?? '').toBe('');
	});
});
