import { describe, expect, it } from 'vitest';
import { renderMathIn } from './math';
import type { BlockContent } from '$lib/sanity/types';

// KaTeX runs for real here — it is a pure function of a string, so there is nothing to mock, and
// mocking it would leave the interesting half (does the position decide displayMode? does a bad
// equation come back as visible source?) untested.

const block = (...children: unknown[]) =>
	({
		_type: 'block',
		_key: 'b',
		style: 'normal',
		markDefs: [],
		children
	}) as unknown as BlockContent[number];

const span = (text: string) => ({ _type: 'span', _key: 's', text, marks: [] });
const inlineMath = (latex: string) => ({ _type: 'mathInline', _key: 'i', latex });
const blockMath = (latex: string) =>
	({ _type: 'mathBlock', _key: 'm', latex }) as BlockContent[number];

// The rendered `html` lives on nodes the return type widens; reading it back needs one narrowing.
const html = (node: unknown) => (node as { html?: string }).html ?? '';

describe('renderMathIn', () => {
	it('returns null for an absent body', () => {
		expect(renderMathIn(null)).toBeNull();
		expect(renderMathIn(undefined)).toBeNull();
	});

	it('typesets a top-level equation in display mode', () => {
		const [node] = renderMathIn([blockMath('E = mc^2')])!;
		expect(html(node)).toContain('katex-display');
	});

	it('typesets an equation inside a text block inline', () => {
		const [node] = renderMathIn([block(span('so '), inlineMath('x^2'))])!;
		const child = (node as { children: unknown[] }).children[1];
		expect(html(child)).toContain('katex');
		// The position decides displayMode, and inline position must NOT centre the equation on its
		// own line — the whole reason mathInline is a separate type.
		expect(html(child)).not.toContain('katex-display');
	});

	it('leaves a body with no math untouched, by reference', () => {
		const body = [block(span('plain prose'))];
		const rendered = renderMathIn(body)!;
		// Every body on the site today takes this path; it must not rebuild the tree (nor change what
		// travels in the SSR payload) just because the renderer ran.
		expect(rendered[0]).toBe(body[0]);
	});

	it('renders nothing for blank LaTeX rather than an empty equation', () => {
		// The Studio rejects this as of DAR-107, but validation only applies to the NEXT publish — it
		// cannot reach anything already stored.
		for (const blank of ['', '   ', '\n\t']) {
			expect(html(renderMathIn([blockMath(blank)])![0])).toBe('');
		}
	});

	it('degrades malformed LaTeX to its own visible source', () => {
		const out = html(renderMathIn([blockMath('\\frac{1}{')])![0]);
		expect(out).toContain('katex-error');
		// Visible, not blank: the source itself is in the output, which is what tells an editor their
		// equation is wrong instead of leaving a gap.
		expect(out).toContain('frac');
	});

	it('paints an error in the theme colour, not KaTeX’s light-theme red', () => {
		const out = html(renderMathIn([blockMath('\\frac{1}{')])![0]);
		expect(out).toContain('var(--color-error-400)');
		expect(out).not.toContain('#cc0000');
	});

	it('survives a latex value that is not a string', () => {
		// The generated type says `latex: string`; a document written straight at the API is under no
		// obligation to agree. This must cost one equation, never the page — and it is not
		// hypothetical bookkeeping: the first version of `typeset` called `.trim()` before its own
		// try/catch, so this test is what found the throw.
		const broken = [{ ...blockMath('x'), latex: 42 }] as unknown as BlockContent;
		expect(html(renderMathIn(broken)![0])).toBe('');
	});

	it('never lets an editor’s string become markup', () => {
		// This is the property the component's {@html} rests on, so it is measured rather than assumed.
		// `trust: false` refuses \href outright — but KaTeX also echoes the raw source back inside the
		// MathML <annotation> (that is how copy-as-TeX works), so "the source never appears" is the
		// WRONG assertion: it appears, escaped, as text. What must never appear is markup.
		const hostile = renderMathIn([blockMath('<script>alert(1)</script>')])!;
		expect(html(hostile[0])).not.toContain('<script');
		expect(html(hostile[0])).toContain('&lt;script&gt;');

		const link = html(renderMathIn([blockMath('\\href{javascript:alert(1)}{x}')])![0]);
		expect(link).not.toContain('<a ');
		expect(link).not.toContain('href=');
	});

	it('is authoritative over `html` — a supplied one is replaced, at both levels', () => {
		// The other half of the {@html} argument, and the one that is easy to lose. `latex` goes
		// through KaTeX, but `html` is rendered VERBATIM, so a document written straight at the Sanity
		// API — which never sees the Studio's schema, and where no such field exists — could otherwise
		// hand the component arbitrary markup to inject. It cannot, because the renderer writes `html`
		// last and unconditionally.
		//
		// Worth a test rather than a comment: reordering the spread to `{ html: …, ...node }` reads as
		// a no-op cleanup and silently makes the supplied value win.
		const injected = '<img src=x onerror=alert(1)>';
		const out = renderMathIn([
			{ ...blockMath('x'), html: injected },
			{ ...block(span('so '), { ...inlineMath('y'), html: injected }) }
		] as unknown as BlockContent)!;

		expect(html(out[0])).not.toContain('onerror');
		expect(html(out[0])).toContain('katex');
		const child = (out[1] as { children: unknown[] }).children[1];
		expect(html(child)).not.toContain('onerror');
		expect(html(child)).toContain('katex');
	});
});
