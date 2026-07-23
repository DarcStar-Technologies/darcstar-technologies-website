<script lang="ts">
	// Renders an inline `image` block inside Portable Text `body` (blockContent's custom image member:
	// asset + alt + caption). Registered as `components.types.image` in PortableBody.
	import type { CustomBlockComponentProps } from '@portabletext/svelte';
	import type { SanityImageAssetReference } from '$lib/sanity/types';
	import SanityImage from '$lib/components/SanityImage.svelte';

	let { portableText }: { portableText: CustomBlockComponentProps } = $props();
	const value = $derived(
		portableText.value as { asset?: SanityImageAssetReference; alt?: string; caption?: string }
	);
</script>

{#if value.asset}
	<figure class="not-prose my-8">
		<SanityImage
			image={value}
			width={1600}
			alt={value.alt ?? ''}
			class="w-full rounded-xl border border-hairline"
		/>
		{#if value.caption}
			<figcaption class="mt-3 text-center text-xs text-muted">{value.caption}</figcaption>
		{/if}
	</figure>
{/if}
