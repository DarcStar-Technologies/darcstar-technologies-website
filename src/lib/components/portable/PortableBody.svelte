<script lang="ts">
	// The single entry point for rendering a Sanity Portable Text `body` (post.body: BlockContent).
	// Default blocks/lists/marks render the correct semantic tags; a `.prose` wrapper (Tailwind
	// Typography, enabled in layout.css) styles them for the dark theme. We only override what the
	// schema adds beyond plain rich text: custom `image`/`code` type blocks and the `link` mark.
	import {
		DefaultListItem,
		PortableText,
		type InputValue,
		type PortableTextComponents
	} from '@portabletext/svelte';
	import type { RenderedBlockContent } from '$lib/sanity/block-content';
	import PortableImage from './PortableImage.svelte';
	import PortableCode from './PortableCode.svelte';
	import PortableLink from './PortableLink.svelte';
	import PortableMath from './PortableMath.svelte';

	// NOT a raw `BlockContent` (DAR-106): the math nodes' `html` is required, so a route that renders
	// a body without sending it through `renderMathIn` ($lib/server/math.ts) fails to type-check
	// rather than dropping every equation on the floor.
	let { value }: { value: RenderedBlockContent | null | undefined } = $props();

	const components: PortableTextComponents = {
		// One component for both math types — see PortableMath for why the difference is a wrapper.
		types: {
			image: PortableImage,
			code: PortableCode,
			mathInline: PortableMath,
			mathBlock: PortableMath
		},
		marks: { link: PortableLink },
		// NOT a map, and not ours to tidy back into one (DAR-208). @portabletext/svelte 3.0.1's
		// RenderListItem looks the block's `style` up in a map keyed by `listItem` values, so a
		// well-formed `<li>` misses every time and warns once per item — `Unknown list item style
		// "normal"` — on every article on the site. Passing a COMPONENT is the library's own escape
		// hatch (`mergeComponents` returns a function override verbatim, and RenderListItem
		// short-circuits on it), which skips both the broken lookup and the warning.
		//
		// It silences no real signal: that warning reports a block style against a listItem-keyed map,
		// so it cannot ever name a list type we failed to handle. The one that can — `Unknown list
		// style "…"` from the sibling RenderList, which reads `node.listItem` correctly — still fires,
		// and the spec pins that it does. Rendering is unchanged: every list item resolved to this
		// same component before, via the map or via `unknownListItem`, and <ul> vs <ol> is RenderList's
		// decision, not this one.
		//
		// Why it matters beyond tidiness: DAR-106 restored `onMissingComponent` to warn precisely so
		// an unrendered content type announces itself. A permanent false warning on every article is
		// how that channel stops being read. Drop this the day upstream fixes the lookup.
		listItem: DefaultListItem
	};
</script>

{#if value && value.length > 0}
	<!-- Tailwind Typography, remapped onto the site's design tokens (prose-invert's default greys
	     don't match text-body/text-white/border-hairline). -->
	<div
		class="prose prose-invert max-w-none prose-headings:font-medium prose-headings:tracking-tight prose-headings:text-white prose-p:text-body prose-li:text-body prose-strong:text-white prose-a:text-primary-500 prose-code:font-mono prose-code:text-white prose-blockquote:border-hairline prose-blockquote:text-emphasis prose-hr:border-hairline"
	>
		<!--
			`onMissingComponent` is left at the library's default (warn). It used to be `false`, which is
			how a whole content type could ship in the Studio and render as nothing here for weeks with
			not even a console line to notice (DAR-106). Silencing it bought nothing visible either: the
			default `unknownType` component renders only its children, and an unknown OBJECT has none.
		-->
		<PortableText value={value as unknown as InputValue} {components} />
	</div>
{/if}
