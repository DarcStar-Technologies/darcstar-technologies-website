import { describe, expect, it } from 'vitest';
import { urlFor, ogImageUrl } from './image';
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
});
