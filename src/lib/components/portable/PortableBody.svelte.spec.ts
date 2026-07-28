import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PortableBody from './PortableBody.svelte';
import type { RenderedBlockContent } from '$lib/sanity/block-content';

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
] as unknown as RenderedBlockContent;

// Already typeset, as the type demands — `renderMathIn` is server-only, so the shape is what a
// component test can hold, not the rendering.
const withMath = [
	{
		_type: 'block',
		_key: 'a',
		style: 'normal',
		markDefs: [],
		children: [
			{ _type: 'span', _key: 's1', text: 'where ', marks: [] },
			{
				_type: 'mathInline',
				_key: 'i',
				latex: 'x',
				html: '<span class="katex" data-testid="inline">x</span>'
			}
		]
	},
	{
		_type: 'mathBlock',
		_key: 'm',
		latex: 'E = mc^2',
		html: '<span class="katex-display" data-testid="display">E = mc^2</span>'
	}
] as unknown as RenderedBlockContent;

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

	it('renders both math types, at both nesting levels', () => {
		// The registration itself is the thing under test. Before DAR-106 these nodes fell through to
		// the library's unknown-type component, which renders an object's (non-existent) children —
		// so the equations vanished, and `onMissingComponent={false}` withheld even the console line.
		const { container } = render(PortableBody, { value: withMath });
		expect(container.querySelector('[data-testid="inline"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="display"]')).not.toBeNull();
	});
});
