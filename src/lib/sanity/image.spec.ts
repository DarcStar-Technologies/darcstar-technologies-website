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

	it('ogImageUrl returns a 1200×630 social-card URL for a populated field', () => {
		const url = ogImageUrl(imageField);
		expect(url).toContain('w=1200');
		expect(url).toContain('h=630');
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
