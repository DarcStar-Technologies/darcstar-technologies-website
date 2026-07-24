import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PaperTopics from './PaperTopics.svelte';

describe('PaperTopics', () => {
	it('renders a tag per topic, with the description as a tooltip', async () => {
		render(PaperTopics, {
			topics: [
				{ _id: 't1', title: 'Efficient Attention', description: 'Faster attention kernels.' },
				{ _id: 't2', title: 'Long-Context' }
			]
		});
		const first = page.getByText('Efficient Attention');
		await expect.element(first).toBeVisible();
		await expect.element(first).toHaveAttribute('title', 'Faster attention kernels.');
		// A description-less topic must carry NO title attribute (the `?? undefined` branch) —
		// an empty-string tooltip would render a blank hover box.
		const second = page.getByText('Long-Context');
		await expect.element(second).toBeVisible();
		await expect.element(second).not.toHaveAttribute('title');
	});

	it('renders nothing without topics', () => {
		const { container } = render(PaperTopics, { topics: null });
		expect(container.textContent?.trim() ?? '').toBe('');
	});
});
