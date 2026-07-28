import katex from 'katex';
import type { RenderedBlockContent } from '$lib/sanity/block-content';
import type { BlockContent } from '$lib/sanity/types';

// Typesetting for the Studio's two LaTeX types (DAR-106): `mathInline`, an atomic node inside a text
// block, and `mathBlock`, a displayed equation of its own. Both store bare LaTeX in `latex`.
//
// It runs HERE, on the server, rather than in the component the ticket sketched. KaTeX is ~272 KB
// minified (~80 KB gzipped) and would land in the client chunk for /news/[slug] and /research/[slug],
// where DAR-53 treated 39 KB — 6.8% of the client bundle — as a saving worth its own ticket. The
// equations are static once rendered, so nothing is lost by rendering them once: the browser gets
// HTML, plus KaTeX's stylesheet and fonts, which it would have needed either way.
//
// Living in `$lib/server` is what makes that structural instead of a habit — Kit refuses to bundle
// this module into the browser, the same move DAR-65 used to keep the lead classifier off public
// pages. The type the component needs is in the client-safe `$lib/sanity/block-content.ts`.

/**
 * The colour KaTeX paints a failed parse in. Its own default is a hardcoded `#cc0000`, which is a
 * light-theme red on a site that is dark-only — so hand it the theme token instead. KaTeX drops this
 * verbatim into a `style` attribute, so a `var()` reference resolves in the browser; if it ever did
 * not, the text falls back to inheriting the surrounding colour, which is still legible. No hex is
 * re-typed here, the same rule the charge triad follows.
 */
const ERROR_COLOR = 'var(--color-error-400)';

type MathNode = { _type: 'mathInline' | 'mathBlock'; latex: string };

function isMath<T extends { _type: string }>(node: T): node is T & MathNode {
	return node._type === 'mathInline' || node._type === 'mathBlock';
}

/**
 * One equation → HTML, or `''` when there is nothing to show.
 *
 * `throwOnError: false` is what makes malformed LaTeX degrade to its own visible source rather than
 * to a blank space — but it only covers `ParseError`, so the `catch` is not decoration: anything else
 * KaTeX throws would otherwise take down the whole page render for one bad equation. A failed
 * equation returns `''` and the component falls back to printing the source as text.
 *
 * Blank LaTeX renders NOTHING rather than an empty KaTeX span. The Studio rejects a whitespace-only
 * `latex` as of DAR-107, but validation only ever applies to the next publish — it cannot reach back
 * into anything already stored.
 *
 * The output is safe to `{@html}`: KaTeX's default `trust: false` refuses the commands that emit
 * markup we did not author (`\href`, `\url`, `\htmlClass`/`Id`/`Style`/`Data`), `maxExpand` bounds
 * macro expansion, and the source it echoes back into the MathML `<annotation>` is escaped.
 */
function typeset(latex: unknown, displayMode: boolean): string {
	// `latex` is TYPED as a required string and can still arrive as something else: the generated type
	// describes the Studio's schema, and the Studio's validation is a UI affordance that a write
	// straight at the API skips (DAR-70's lesson about `rule.uri`). Checked rather than trusted
	// because this runs OUTSIDE the try below — the cost of assuming is the whole page render, not
	// one equation. Found by the test that fires when KaTeX throws.
	if (typeof latex !== 'string' || !latex.trim()) return '';
	try {
		return katex.renderToString(latex, {
			displayMode,
			throwOnError: false,
			errorColor: ERROR_COLOR
		});
	} catch (err) {
		console.error('[math] KaTeX failed to render an equation', err);
		return '';
	}
}

/**
 * Typesets every math node in a Portable Text body, leaving everything else untouched.
 *
 * `displayMode` comes from WHERE the node sits, not from its `_type`: top level is a displayed
 * equation, inside a block's `children` is inline. The schema already guarantees the two agree —
 * reading the position means the rendering matches the markup it is emitted into even if they ever
 * stop agreeing.
 *
 * The one cast in this file is the return. An imperative walk cannot prove to the compiler that it
 * produced the mapped type, so this function is the single place that mints a `RenderedBlockContent`
 * — the same shape as DAR-99's signing secret, where the brand is real precisely because exactly one
 * file may claim it.
 */
export function renderMathIn(body: BlockContent | null | undefined): RenderedBlockContent | null {
	if (!body) return null;
	return body.map((node) => {
		if (isMath(node)) return { ...node, html: typeset(node.latex, true) };
		// Rebuilt only when a block actually contains math; a body with none — which is every body on
		// the site today — passes its nodes through by reference.
		if (node._type === 'block' && node.children?.some(isMath)) {
			return {
				...node,
				children: node.children.map((child) =>
					isMath(child) ? { ...child, html: typeset(child.latex, false) } : child
				)
			};
		}
		return node;
	}) as RenderedBlockContent;
}
