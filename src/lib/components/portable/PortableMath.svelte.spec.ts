import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { CustomBlockComponentProps } from '@portabletext/svelte';
import PortableMath from './PortableMath.svelte';

// Runs in the `client` project's real chromium, which is what makes the stylesheet assertion below
// mean anything: whether KaTeX's CSS actually reaches the page is a property of the bundle, not of
// the markup, and jsdom would report a pass either way.

const props = (value: unknown, isInline: boolean) =>
	({ portableText: { value, isInline } as unknown as CustomBlockComponentProps }) as never;

const KATEX_INLINE = '<span class="katex"><span class="katex-html">x</span></span>';
const KATEX_DISPLAY = `<span class="katex-display">${KATEX_INLINE}</span>`;

describe('PortableMath', () => {
	it('renders a displayed equation inside a scrollable wrapper', () => {
		const { container } = render(
			PortableMath,
			props({ _type: 'mathBlock', latex: 'x', html: KATEX_DISPLAY }, false)
		);
		// A wide equation must scroll rather than push the article's layout sideways.
		const wrapper = container.querySelector('div.overflow-x-auto');
		expect(wrapper?.querySelector('.katex-display')).not.toBeNull();
	});

	it('renders an inline equation with no wrapper of its own', () => {
		const { container } = render(
			PortableMath,
			props({ _type: 'mathInline', latex: 'x', html: KATEX_INLINE }, true)
		);
		// Inline math sits mid-sentence inside a <p>; a block wrapper there would break the line.
		expect(container.querySelector('div')).toBeNull();
		expect(container.querySelector('.katex')).not.toBeNull();
	});

	it('applies KaTeX’s own stylesheet', async () => {
		render(PortableMath, props({ _type: 'mathInline', latex: 'x', html: KATEX_INLINE }, true));
		const katex = document.querySelector('.katex');
		expect(katex).not.toBeNull();
		// The component imports the stylesheet so Vite scopes it to the routes that can contain math.
		// If that import were dropped the markup would still render — as unstyled, misaligned prose —
		// so the font family is the only thing that can tell the two apart.
		await expect.poll(() => getComputedStyle(katex!).fontFamily).toContain('KaTeX_Main');
	});

	it('shows the source when there is no rendered html', async () => {
		// Silence is the failure DAR-106 exists to remove, so an equation that could not be typeset —
		// or one that reached a page whose load forgot to typeset it — must be visible, not a gap.
		render(PortableMath, props({ _type: 'mathBlock', latex: '\\frac{1}{', html: '' }, false));
		await expect.element(page.getByText('\\frac{1}{')).toBeVisible();
	});

	it('renders nothing at all for an empty equation', () => {
		const { container } = render(
			PortableMath,
			props({ _type: 'mathBlock', latex: '   ', html: '' }, false)
		);
		expect(container.textContent?.trim() ?? '').toBe('');
	});

	it('renders nothing rather than throwing on a latex value that is not a string', () => {
		// Mirrors the server-side guard: the CMS type promises a string, an API write need not honour
		// it, and a throw in a component takes the whole page rather than one equation.
		const { container } = render(PortableMath, props({ _type: 'mathBlock', latex: 42 }, false));
		expect(container.textContent?.trim() ?? '').toBe('');
	});
});
