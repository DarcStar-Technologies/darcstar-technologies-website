<script lang="ts">
	// The single entry point for rendering a Sanity Portable Text `body` (post.body: BlockContent).
	// Default blocks/lists/marks render the correct semantic tags; a `.prose` wrapper (Tailwind
	// Typography, enabled in layout.css) styles them for the dark theme. We only override what the
	// schema adds beyond plain rich text: custom `image`/`code` type blocks and the `link` mark.
	import { PortableText, type InputValue, type PortableTextComponents } from '@portabletext/svelte';
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
		marks: { link: PortableLink }
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
