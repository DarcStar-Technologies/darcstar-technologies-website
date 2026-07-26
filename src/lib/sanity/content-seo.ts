import { ogImageUrl } from './image';
import { isHttpUrl } from '$lib/jsonld';
import type { SeoProps } from '$lib/components/Seo.svelte';
import type { Seo } from './types';

// The ONE path from a Sanity document's `seo` object to <Seo>'s props (DAR-71). Both content detail
// pages (/news/[slug], /research/[slug]) call this and spread the result, so every field the Studio's
// SEO tab exposes is wired in exactly one place.
//
// It exists because the previous arrangement — each page hand-mapping metaTitle → metaDescription →
// ogImage into separate props — is how `noIndex` came to be fetched, typed, and then silently dropped
// at BOTH render sites: the toggle was a no-op end to end, with no signal to the editor. Adding a
// field to the Studio's seo object? Wire it here, extend the spec's truth table, and both pages get
// it. Never re-derive one of these at a call site.
//
// The other half of DAR-71 is in queries.ts: `seo.noIndex != true` on sitemapEntriesQuery. That rule
// can't share this code (it's GROQ, evaluated by Sanity), so the two are pinned separately —
// content-seo.spec.ts here, queries.spec.ts there — and MUST keep the same polarity.

/** Per-document defaults for the fields the editor left blank. All optional but `title`. */
export interface ContentSeoFallbacks {
	/** Page <title> when the document sets no `seo.metaTitle`. */
	title: string;
	/** Meta/OG description when the document sets no `seo.metaDescription`. */
	description?: string;
	/** Image field to fall back to when `seo.ogImage` is unset or asset-less (e.g. a post's coverImage). */
	image?: { asset?: { _ref?: string } } | null;
	/** alt for whichever content image wins. Ignored when neither resolves — <Seo> then serves the
	 * brand OG card, which has its own alt (`seo_default_image_alt`). */
	imageAlt?: string;
	/** Absolute URL to canonicalise to when the editor set no `seo.canonicalUrl` — the page's own
	 * derivation (DAR-70: a third-party paper's source URL). Omit to stay self-canonical. */
	canonical?: string;
}

/** The <Seo> props this mapper owns. `path`/`type`/`jsonLd` stay with the page — they're routing
 * and structured-data concerns, not CMS fields.
 *
 * Deriving this from Seo.svelte's own exported SeoProps is what makes a MISNAMED key a compile
 * error. A Svelte spread silently ignores props the component doesn't declare, so `<Seo {...obj} />`
 * alone would happily ship `noIndex` (capital I) as a no-op — a fair description of the bug DAR-71
 * exists to fix. What the type can't catch is a key OMITTED entirely: every SeoProps field is
 * optional, so `Pick` of them is too. That half is on content-seo.spec.ts, which asserts each key's
 * value — verified by deleting the `noindex` line and watching 5 tests go red. Both halves have to
 * stay: neither guard covers the other's failure shape. */
export type ContentSeoProps = Pick<
	SeoProps,
	'title' | 'description' | 'image' | 'imageAlt' | 'noindex' | 'canonical'
>;

/**
 * Map a document's `seo` object onto the <Seo> prop set. Spread the result:
 * `<Seo {...contentSeo(post.seo, {…})} type="article" {jsonLd} />`.
 *
 * `undefined` in the returned object is meaningful, not a gap — <Seo> destructures its props with
 * defaults, so an explicitly-undefined `image`/`description`/`imageAlt` resolves to the site-wide
 * default exactly as a page passing nothing would.
 */
export function contentSeo(
	seo: Seo | null | undefined,
	fallbacks: ContentSeoFallbacks
): ContentSeoProps {
	// `ogImageUrl(a) ?? ogImageUrl(b)` rather than `??` on the fields: an ogImage object that exists
	// but carries no asset must fall THROUGH to the fallback, not shadow it with a broken image.
	const image = ogImageUrl(seo?.ogImage) ?? ogImageUrl(fallbacks.image);

	// Editor override first, then the page's derivation — but BOTH through the same absolute-http(s)
	// gate. The derived value is already sanitized inside paperSourceUrls, and the Studio validates
	// canonicalUrl's scheme; Studio validation is a UI affordance rather than a boundary, though (an
	// API write skips it), and two inputs to one output must not carry different guarantees. Same
	// fall-THROUGH shape as the image above: an unusable override drops to the derivation rather than
	// shadowing it, so a typo'd field costs the page its best canonical, not its only one.
	const canonical = [seo?.canonicalUrl, fallbacks.canonical]
		.map((value) => value?.trim())
		.find((value) => value !== undefined && isHttpUrl(value));

	return {
		title: seo?.metaTitle ?? fallbacks.title,
		description: seo?.metaDescription ?? fallbacks.description,
		image,
		imageAlt: image ? fallbacks.imageAlt : undefined,
		// Hiding needs a POSITIVE signal — unset/null (the state of every document today) stays
		// indexable, so shipping this can't quietly de-index the site. Explicit `=== true` rather
		// than `??`/truthiness so the boolean coercion happens once, here, at the CMS boundary.
		// <Seo> ORs this with its untranslated-locale rule, so the two compose.
		noindex: seo?.noIndex === true,
		// Resolved above. Undefined from both leaves <Seo> self-canonical, and only the canonical
		// LINK ever moves — og:url stays our own URL.
		canonical
	};
}
