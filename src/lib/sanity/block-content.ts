import type { BlockContent } from './types';

// The shape `PortableBody` accepts: a `BlockContent` whose math has already been typeset (DAR-106).
//
// This module exists to be CLIENT-SAFE. The typesetter itself is `$lib/server/math.ts`, because
// KaTeX is ~270 KB of JavaScript that the browser has no reason to carry — the equations are static,
// so they are rendered once during the server load and travel as HTML. A component cannot import
// from `$lib/server`, so the type it needs to describe that data has to live outside it.

/**
 * Adds the rendered `html` to the two math members of a `blockContent` union, recursing into a
 * block's `children` (where `mathInline` lives). Distributive: `T` is a naked type parameter, so
 * each union member is tested on its own.
 */
type WithRenderedMath<T> = T extends { _type: 'mathInline' | 'mathBlock' }
	? T & { html: string }
	: T extends { _type: 'block'; children?: Array<infer Child> }
		? Omit<T, 'children'> & { children?: Array<WithRenderedMath<Child>> }
		: T;

/**
 * `BlockContent` after `renderMathIn`.
 *
 * `html` is REQUIRED here, and that is the whole point: a raw `BlockContent` is not assignable to
 * this, so a route that renders `<PortableBody>` without sending its body through the server-side
 * typesetter fails `pnpm check`. It does not silently render nothing — which is precisely the bug
 * DAR-106 exists to fix, since `onMissingComponent={false}` made the previous version of that
 * failure invisible even in the console.
 *
 * `block-content.spec.ts` pins the gate with a `@ts-expect-error`, so the day the conditional type
 * stops discriminating, the unused directive is itself a type error.
 */
export type RenderedBlockContent = Array<WithRenderedMath<BlockContent[number]>>;
