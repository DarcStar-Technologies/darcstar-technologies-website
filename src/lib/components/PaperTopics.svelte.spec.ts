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
		await expect.element(page.getByText('Long-Context')).toBeVisible();
	});

	it('renders nothing without topics', () => {
		const { container } = render(PaperTopics, { topics: null });
		expect(container.textContent?.trim() ?? '').toBe('');
	});
});
