import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PortableBody from './PortableBody.svelte';
import type { BlockContent } from '$lib/sanity/types';

// Smoke test: the default block renderer (+ our `.prose` wrapper) turns a Portable Text `body` into
// real semantic markup — a paragraph and an <h2> — so the /news detail page actually shows content.
const blocks = [
	{
		_type: 'block',
		_key: 'a',
		style: 'normal',
		markDefs: [],
		children: [{ _type: 'span', _key: 's1', text: 'Hello from Portable Text', marks: [] }]
	},
	{
		_type: 'block',
		_key: 'b',
		style: 'h2',
		markDefs: [],
		children: [{ _type: 'span', _key: 's2', text: 'A section heading', marks: [] }]
	}
] as unknown as BlockContent;

describe('PortableBody', () => {
	it('renders paragraph text and a heading block', async () => {
		render(PortableBody, { value: blocks });
		await expect.element(page.getByText('Hello from Portable Text')).toBeVisible();
		await expect
			.element(page.getByRole('heading', { level: 2, name: 'A section heading' }))
			.toBeVisible();
	});

	it('renders nothing for an empty body', () => {
		const { container } = render(PortableBody, { value: null });
		expect(container.textContent?.trim() ?? '').toBe('');
	});
});
