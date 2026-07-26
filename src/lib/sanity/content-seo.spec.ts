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
