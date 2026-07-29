import { describe, expect, it } from 'vitest';
import { urlFor, ogImageUrl, imageUrl } from './image';
import { dataset, projectId } from './config';

// A well-formed Sanity image asset ref (`image-<id>-<w>x<h>-<fmt>`) is all @sanity/image-url needs to
// synthesise a CDN URL — no network. These lock the project/dataset scoping, the auto-format flag,
// the requested dimensions, and the empty-field guard.
const imageField = {
	_type: 'image' as const,
	asset: { _ref: 'image-abc123def456-1200x800-jpg', _type: 'reference' as const }
};

describe('sanity image URLs', () => {
	it('urlFor builds a cdn.sanity.io URL scoped to the project + dataset', () => {
		const url = urlFor(imageField).width(400).url();
		expect(url).toContain(`cdn.sanity.io/images/${projectId}/${dataset}/`);
		expect(url).toContain('w=400');
		expect(url).toContain('auto=format');
	});

	// `w`/`h` alone do NOT give you a 1200×630 image, and asserting them was how that went unnoticed
	// for the life of this helper: the builder's default fit is `clip`, which fits INSIDE the box and
	// preserves the source aspect ratio. Measured against the real CDN, asking for 1200×630 of the
	// founder's portrait returned **504×630** — a portrait social card, from a URL this test called
	// correct. `fit=crop` is the parameter that makes the delivered image match the request, and it
	// honors the hotspot the editor set. (It had never mattered before DAR-122: no post carries a
	// coverImage and no document sets `seo.ogImage`, so every page fell through to the brand card.)
	it('ogImageUrl really is 1200×630, not merely asking for it', () => {
		const url = ogImageUrl(imageField);
		expect(url).toContain('w=1200');
		expect(url).toContain('h=630');
		expect(url).toContain('fit=crop');
	});

	it('ogImageUrl returns undefined for an empty/absent image field', () => {
		expect(ogImageUrl(null)).toBeUndefined();
		expect(ogImageUrl(undefined)).toBeUndefined();
		expect(ogImageUrl({})).toBeUndefined();
	});

	it('imageUrl builds a width-only or width+height URL (no auto=format — metadata consumers)', () => {
		const widthOnly = imageUrl(imageField, 600)!;
		expect(widthOnly).toContain(`cdn.sanity.io/images/${projectId}/${dataset}/`);
		expect(widthOnly).toContain('w=600');
		expect(widthOnly).not.toContain('h=');
		expect(widthOnly).not.toContain('auto=format');
		expect(imageUrl(imageField, 1200, 630)).toContain('h=630');
	});

	// The crop is scoped to callers that name BOTH dimensions — those are asking for a shape. A
	// width-only caller (the JSON-LD portrait) wants the image scaled, and cropping it to some
	// implied height would silently change what the picture is of.
	it('crops only when a height is asked for', () => {
		expect(imageUrl(imageField, 600)).not.toContain('fit=crop');
		expect(imageUrl(imageField, 1200, 630)).toContain('fit=crop');
	});

	it('imageUrl degrades to undefined on empty fields AND malformed refs (never throws)', () => {
		expect(imageUrl(null, 600)).toBeUndefined();
		expect(imageUrl(undefined, 600)).toBeUndefined();
		expect(imageUrl({}, 600)).toBeUndefined();
		expect(imageUrl({ asset: null }, 600)).toBeUndefined();
		// A `?.asset` guard alone would NOT catch these: @sanity/image-url's parseAssetId throws
		// on an empty/garbage _ref — a broken CMS doc must mean "no image", not an SSR 500.
		expect(imageUrl({ asset: { _ref: '' } }, 600)).toBeUndefined();
		expect(imageUrl({ asset: { _ref: 'not-a-real-ref' } }, 600)).toBeUndefined();
	});
});
