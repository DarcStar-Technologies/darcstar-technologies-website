<script lang="ts">
	// The single entry point for rendering a Sanity Portable Text `body` (post.body: BlockContent).
	// Default blocks/lists/marks render the correct semantic tags; a `.prose` wrapper (Tailwind
	// Typography, enabled in layout.css) styles them for the dark theme. We only override what the
	// schema adds beyond plain rich text: custom `image`/`code` type blocks and the `link` mark.
	import { PortableText, type InputValue, type PortableTextComponents } from '@portabletext/svelte';
	import type { BlockContent } from '$lib/sanity/types';
	import PortableImage from './PortableImage.svelte';
	import PortableCode from './PortableCode.svelte';
	import PortableLink from './PortableLink.svelte';

	let { value }: { value: BlockContent | null | undefined } = $props();

	const components: PortableTextComponents = {
		types: { image: PortableImage, code: PortableCode },
		marks: { link: PortableLink }
	};
</script>

{#if value && value.length > 0}
	<!-- Tailwind Typography, remapped onto the site's design tokens (prose-invert's default greys
	     don't match text-body/text-white/border-hairline). -->
	<div
		class="prose prose-invert max-w-none prose-headings:font-medium prose-headings:tracking-tight prose-headings:text-white prose-p:text-body prose-li:text-body prose-strong:text-white prose-a:text-primary-500 prose-code:font-mono prose-code:text-white prose-blockquote:border-hairline prose-blockquote:text-emphasis prose-hr:border-hairline"
	>
		<PortableText value={value as unknown as InputValue} {components} onMissingComponent={false} />
	</div>
{/if}
