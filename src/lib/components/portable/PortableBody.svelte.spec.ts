import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
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

// Portable Text has no list node: a run of blocks sharing `listItem` and `level` is grouped into a
// virtual one by the library. `style` stays 'normal' — it is the BLOCK style, orthogonal to the list
// type — and conflating the two is exactly the upstream bug behind DAR-208.
const list = (listItem: string, style = 'normal') =>
	[
		{
			_type: 'block',
			_key: 'l1',
			style,
			listItem,
			level: 1,
			markDefs: [],
			children: [{ _type: 'span', _key: 's1', text: 'First item', marks: [] }]
		},
		{
			_type: 'block',
			_key: 'l2',
			style,
			listItem,
			level: 1,
			markDefs: [],
			children: [{ _type: 'span', _key: 's2', text: 'Second item', marks: [] }]
		}
	] as unknown as RenderedBlockContent;

// The library reports a missing component from an `$effect` rather than during render. Today that
// still lands synchronously — `render()` mounts and flushes — so a spy read straight afterwards
// already sees it: measured, and dropping this wait leaves the pre-fix cases failing exactly as they
// should. It is kept as the cheap guard against that changing, because the failure would be silent
// in the worst direction: every "without warning about anything" case below would start reading an
// empty spy and pass vacuously, while its DOM assertion — synchronous either way — went on passing
// and hid it.
async function renderCapturingWarnings(value: RenderedBlockContent) {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const { container } = render(PortableBody, { value });
		await vi.waitFor(() => expect(container.querySelector('li')).not.toBeNull());
		return { container, warnings: warn.mock.calls.flat().join('\n') };
	} finally {
		warn.mockRestore();
	}
}

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

	it('warns about a type it has no component for', async () => {
		// Guards the flag, not the library: `onMissingComponent={false}` is what made DAR-106's gap
		// silent, and re-adding it would be a one-word change with no other visible effect. The
		// warning is the ONLY observable, so nothing else could catch it.
		//
		// Worth knowing where it lands: the library calls the handler from an `$effect`, which does
		// not run during SSR — so this is a BROWSER console line, never a Workers Logs one. That is
		// also why the assertion has to be here, in a real browser, rather than in a server spec.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			render(PortableBody, {
				value: [{ _type: 'somethingNew', _key: 'x' }] as unknown as RenderedBlockContent
			});
			await vi.waitFor(() => expect(warn).toHaveBeenCalled());
			expect(warn.mock.calls.flat().join(' ')).toContain('somethingNew');
		} finally {
			warn.mockRestore();
		}
	});

	// DAR-208: every one of these warned once per item before `components.listItem` became a single
	// component — `Unknown list item style "normal"`, on every article on the site — because 3.0.1
	// looks the block's `style` up in a map keyed by `listItem` values.
	//
	// Each case also asserts what it RENDERED, so "no warnings" can't pass against a body that
	// rendered nothing; the two `warns…` tests above and below are the positive controls proving the
	// spy still catches a real one.
	it.each([
		['a bullet list', list('bullet'), 'ul'],
		// <ul> vs <ol> is RenderList's decision, from `node.listItem` — the override replaces the
		// per-item component, so this is the assertion that it didn't flatten the two into one.
		['a numbered list', list('number'), 'ol'],
		// The case that rules out the smaller patch. `listItem: { normal: DefaultListItem }` merges
		// into the default map and silences the common case, but a list item carrying a block style
		// warns under that style's own name — measured: `Unknown list item style "h2"` — so the map
		// shape fixes the symptom for exactly the content that happens to be plain today.
		['a list item with a heading style', list('bullet', 'h2'), 'ul']
	])('renders %s without warning about anything', async (_label, value, tag) => {
		const { container, warnings } = await renderCapturingWarnings(value);
		expect(container.querySelectorAll(`${tag} > li`)).toHaveLength(2);
		expect(warnings).toBe('');
	});

	it('still warns about a list type it has no component for', async () => {
		// The signal the override must NOT cost us, and the reason silencing the other one is free:
		// this warning comes from the sibling RenderList, which reads `node.listItem` correctly, so
		// an unhandled list type still announces itself. The one DAR-208 removes could only ever
		// report a block style against a listItem-keyed map — it never had a true thing to say.
		const { warnings } = await renderCapturingWarnings(list('checkbox'));
		expect(warnings).toContain('checkbox');
	});
});
