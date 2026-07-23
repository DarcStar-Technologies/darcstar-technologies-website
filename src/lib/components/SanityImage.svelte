<script lang="ts">
	import type { SanityImageSource } from '@sanity/image-url';
	import type {
		SanityImageAssetReference,
		SanityImageCrop,
		SanityImageHotspot
	} from '$lib/sanity/types';
	import { urlFor } from '$lib/sanity/image';

	// One place that turns a Sanity image FIELD into a sized, format-negotiated <img>. Reused by the
	// /news cards + cover, /people avatars, and Portable Text image blocks so the URL-building never
	// drifts. `image` is typed as the structural minimum the generated query shapes all satisfy
	// (their `asset` is optional, which is why urlFor — whose `SanityImageSource` needs a definite
	// asset — is only called inside the `image.asset` guard, with one documented cast).
	type SanityImageField = {
		asset?: SanityImageAssetReference;
		hotspot?: SanityImageHotspot;
		crop?: SanityImageCrop;
	};

	interface Props {
		image: SanityImageField | null | undefined;
		/** Rendered width in px; also the CDN request width (retina handled by the source density). */
		width: number;
		/** Optional CDN request height — omit to preserve the source aspect ratio. */
		height?: number;
		alt?: string;
		class?: string;
		loading?: 'lazy' | 'eager';
	}

	let { image, width, height, alt = '', class: klass, loading = 'lazy' }: Props = $props();

	const src = $derived.by(() => {
		if (!image?.asset) return null;
		// Cast: the generated field type has an OPTIONAL asset (an image field can be empty), but we've
		// just proven it's present — `SanityImageSource` wants a definite asset. Runtime-safe.
		const b = urlFor(image as unknown as SanityImageSource).width(width);
		return (height ? b.height(height) : b).url();
	});
</script>

{#if src}
	<img {src} {alt} {width} {height} {loading} decoding="async" class={klass} />
{/if}
