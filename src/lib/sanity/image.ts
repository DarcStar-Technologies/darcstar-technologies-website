import { createImageUrlBuilder, type SanityImageSource } from '@sanity/image-url';
import { dataset, projectId } from './config';

// `urlFor(image).width(800).auto('format').url()` — the standard @sanity/image-url chain. The builder
// only needs the public project/dataset (config.ts constants), NOT a Sanity client — so it runs in
// the browser (image src on hydration) without pulling the token-bearing server client into the
// client bundle. Asset BINARIES on cdn.sanity.io are public by their hashed URL even though this
// project gates document READS behind a token (see $lib/server/sanity.ts). Pass the image FIELD
// object (GROQ keeps `asset._ref` intact) so the builder resolves the ref → sized CDN URL + hotspot/
// crop. Guard callers with `{#if image}` — the builder throws on null.
const builder = createImageUrlBuilder({ projectId, dataset });

export function urlFor(source: SanityImageSource) {
	return builder.image(source).auto('format');
}

// A sized absolute CDN URL for a Sanity image FIELD (the structural shape TypeGen emits), or
// `undefined` when the field is empty — this helper owns the one `as SanityImageSource` coercion
// so callers never cast. It also survives a malformed doc: @sanity/image-url's parseAssetId
// THROWS on an empty/garbage `_ref` (which a mere `?.asset` guard doesn't catch), and a broken
// CMS ref must degrade to "no image", never 500 an SSR render. No `auto('format')` — plain
// fixed URLs for metadata consumers (OG scrapers, JSON-LD crawlers); UI rendering wants urlFor.
export function imageUrl(
	image: { asset?: { _ref?: string } | null } | null | undefined,
	width: number,
	height?: number
): string | undefined {
	if (!image?.asset?._ref) return undefined;
	try {
		let sized = builder.image(image as unknown as SanityImageSource).width(width);
		if (height !== undefined) sized = sized.height(height);
		return sized.url();
	} catch {
		return undefined;
	}
}

// A 1200×630 absolute CDN URL for a Sanity image field, sized for the OG/Twitter social card, or
// `undefined` when the field is empty. Detail pages pass the result straight to <Seo image=…>, which
// (thanks to its absolute-URL branch) uses it verbatim instead of resolving it against the origin.
export function ogImageUrl(
	image: { asset?: { _ref?: string } } | null | undefined
): string | undefined {
	return imageUrl(image, 1200, 630);
}
