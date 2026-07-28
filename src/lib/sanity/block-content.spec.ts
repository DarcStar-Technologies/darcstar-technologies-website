import { describe, expect, it } from 'vitest';
import type { RenderedBlockContent } from './block-content';
import type { BlockContent } from './types';

// The gate DAR-106 relies on is a type, so its test is a type-level one and `pnpm check` is what
// runs it. The runtime `expect`s below exist only because vitest requires an assertion per test —
// they are not the thing being verified.
//
// This matters because the property is invisible at runtime: a route that skipped `renderMathIn`
// would render every equation as nothing, in silence, which is the exact bug this ticket closes.

const withoutMath: BlockContent = [
	{
		_type: 'block',
		_key: 'b',
		style: 'normal',
		markDefs: [],
		children: [{ _type: 'span', _key: 's', text: 'no equations here', marks: [] }]
	}
];

describe('RenderedBlockContent', () => {
	it('refuses a body straight from the CMS, math or not', () => {
		// The directive below IS the assertion: `html` is required on the two math members, so a raw
		// BlockContent is not assignable however innocent its runtime value. Should the conditional
		// type ever stop discriminating, TypeScript reports the directive as unused and `pnpm check`
		// goes red — the gate cannot quietly stop holding.
		//
		// Keep the directive on its own line and never open a comment line with its name: a second
		// mention at the start of a `//` line is a second REAL directive, and it swallows the error
		// the first one was placed to catch. (Measured — that is how this comment came to be worded
		// this way.)
		// @ts-expect-error -- a body straight from the CMS has not been typeset
		const rendered: RenderedBlockContent = withoutMath;
		expect(rendered).toBe(withoutMath);
	});

	it('accepts math that carries its rendered html, at both nesting levels', () => {
		const rendered: RenderedBlockContent = [
			{ _type: 'mathBlock', _key: 'm', latex: 'E = mc^2', html: '<span class="katex"></span>' },
			{
				_type: 'block',
				_key: 'b',
				style: 'normal',
				markDefs: [],
				children: [
					{ _type: 'span', _key: 's', text: 'inline ', marks: [] },
					{ _type: 'mathInline', _key: 'i', latex: 'x^2', html: '<span class="katex"></span>' }
				]
			}
		];
		expect(rendered).toHaveLength(2);
	});
});
