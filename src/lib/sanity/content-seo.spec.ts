import { describe, expect, it } from 'vitest';
import { contentSeo } from './content-seo';
import type { Seo } from './types';

// contentSeo is the ONLY path from a Sanity document's `seo` object to <Seo>'s props (DAR-71), so
// this spec is the coverage for the whole mapping — the detail pages just spread the result and
// can't be unit-tested without mocking a SvelteKit page load.
//
// The noindex truth table is the load-bearing part. "Hide from search engines" was fetched, typed,
// and dropped at both render sites for the life of the feature, and it stays untestable end-to-end:
// CI is hermetic (no Sanity token) and no live document sets the flag, so this table IS the proof.

// A well-formed asset ref is all @sanity/image-url needs to synthesise a CDN URL — no network.
const ogImage = {
	_type: 'image' as const,
	asset: { _ref: 'image-aaa111bbb222-1200x630-png', _type: 'reference' as const }
};
const coverImage = {
	_type: 'image' as const,
	asset: { _ref: 'image-ccc333ddd444-1600x900-jpg', _type: 'reference' as const }
};

const base = { title: 'Fallback title' };

describe('contentSeo — hide from search engines', () => {
	// Fail-open by design: hiding needs a POSITIVE signal, so every state that isn't an explicit
	// `true` stays indexable. Flipping this polarity would de-index every post and paper on the
	// site in one deploy — no document sets `seo` at all today.
	it.each([
		['no seo object at all', undefined],
		['a null seo object', null],
		['an empty seo object', { _type: 'seo' } as Seo],
		['noIndex explicitly false', { _type: 'seo', noIndex: false } as Seo]
	])('stays indexable with %s', (_case, seo) => {
		expect(contentSeo(seo, base).noindex).toBe(false);
	});

	it('is noindex only when the editor set the flag', () => {
		expect(contentSeo({ _type: 'seo', noIndex: true }, base).noindex).toBe(true);
	});
});

// DAR-70: a third-party paper page reproduces the source's abstract, so it canonicalises to the
// original. Two inputs — the editor's explicit `seo.canonicalUrl`, and the page's derived source
// URL — with the editor winning. Only the canonical LINK moves; <Seo> keeps og:url on our own URL.
describe('contentSeo — canonical', () => {
	const SOURCE = 'https://arxiv.org/abs/1706.03762';
	const OVERRIDE = 'https://proceedings.example/attention';

	it('lets the editor override the page-derived source URL', () => {
		const seo = contentSeo(
			{ _type: 'seo', canonicalUrl: OVERRIDE },
			{ ...base, canonical: SOURCE }
		);
		expect(seo.canonical).toBe(OVERRIDE);
	});

	it('uses the page-derived source URL when the editor set none', () => {
		expect(contentSeo({ _type: 'seo' }, { ...base, canonical: SOURCE }).canonical).toBe(SOURCE);
		expect(contentSeo(null, { ...base, canonical: SOURCE }).canonical).toBe(SOURCE);
	});

	it('stays self-canonical when neither supplies one', () => {
		// undefined, not '' — <Seo> falls back to the page's own URL only on undefined.
		expect(contentSeo(null, base).canonical).toBeUndefined();
		expect(contentSeo({ _type: 'seo' }, base).canonical).toBeUndefined();
	});

	it('rejects an unusable override and falls through to the derivation', () => {
		// The Studio validates canonicalUrl's scheme, but that's a UI affordance — an API write
		// skips it. A typo'd field must cost the page its best canonical, not its only one.
		for (const junk of ['not a url', '/research/relative', 'javascript:alert(1)', '   ']) {
			expect(
				contentSeo({ _type: 'seo', canonicalUrl: junk }, { ...base, canonical: SOURCE })
			).toHaveProperty('canonical', SOURCE);
		}
	});

	it('emits no canonical at all when neither input is usable', () => {
		// Never a broken canonical: pointing crawlers somewhere wrong is worse than pointing nowhere.
		expect(
			contentSeo({ _type: 'seo', canonicalUrl: 'mailto:x@y.z' }, { ...base, canonical: 'nonsense' })
				.canonical
		).toBeUndefined();
	});

	it('trims surrounding whitespace on an otherwise good override', () => {
		expect(contentSeo({ _type: 'seo', canonicalUrl: `  ${OVERRIDE}  ` }, base).canonical).toBe(
			OVERRIDE
		);
	});

	it('does not let an editor canonical leak into the other fields', () => {
		// Guards against a copy-paste in the mapper — canonical is its own slot, not a title/image.
		const seo = contentSeo({ _type: 'seo', canonicalUrl: OVERRIDE }, base);
		expect(seo.title).toBe('Fallback title');
		expect(seo.description).toBeUndefined();
		expect(seo.image).toBeUndefined();
		expect(seo.noindex).toBe(false);
	});
});

describe('contentSeo — fallbacks', () => {
	it('prefers the document metaTitle/metaDescription over the page fallbacks', () => {
		const seo = contentSeo(
			{ _type: 'seo', metaTitle: 'From CMS', metaDescription: 'Also CMS' },
			{
				title: 'Fallback title',
				description: 'Fallback description'
			}
		);
		expect(seo.title).toBe('From CMS');
		expect(seo.description).toBe('Also CMS');
	});

	it('falls back per-field — a metaTitle alone does not blank the description', () => {
		const seo = contentSeo(
			{ _type: 'seo', metaTitle: 'From CMS' },
			{
				title: 'Fallback title',
				description: 'Fallback description'
			}
		);
		expect(seo.title).toBe('From CMS');
		expect(seo.description).toBe('Fallback description');
	});

	it('leaves description/image/imageAlt undefined when nothing supplies them, so <Seo> uses its own defaults', () => {
		const seo = contentSeo(null, base);
		expect(seo.title).toBe('Fallback title');
		expect(seo.description).toBeUndefined();
		expect(seo.image).toBeUndefined();
		// The brand OG card carries its own alt (seo_default_image_alt) — passing the doc title
		// here would mislabel it.
		expect(seo.imageAlt).toBeUndefined();
	});

	it('prefers seo.ogImage over the page fallback image, and labels it', () => {
		const seo = contentSeo(
			{ _type: 'seo', ogImage },
			{ ...base, image: coverImage, imageAlt: 'Doc title' }
		);
		expect(seo.image).toContain('aaa111bbb222');
		expect(seo.image).toContain('w=1200');
		expect(seo.image).toContain('h=630');
		expect(seo.imageAlt).toBe('Doc title');
	});

	it('falls THROUGH an asset-less ogImage to the page fallback image', () => {
		// The bug this shape guards: `seo?.ogImage ?? fallbacks.image` would pick the empty object
		// (it is non-null) and render no image at all.
		const seo = contentSeo(
			{ _type: 'seo', ogImage: { _type: 'image' } },
			{
				...base,
				image: coverImage,
				imageAlt: 'Doc title'
			}
		);
		expect(seo.image).toContain('ccc333ddd444');
		expect(seo.imageAlt).toBe('Doc title');
	});

	it('drops imageAlt when neither image resolves, even though the page supplied one', () => {
		const seo = contentSeo(null, { ...base, imageAlt: 'Doc title' });
		expect(seo.image).toBeUndefined();
		expect(seo.imageAlt).toBeUndefined();
	});
});
