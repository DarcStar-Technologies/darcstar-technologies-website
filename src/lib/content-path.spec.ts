import { describe, expect, it } from 'vitest';
import { contentPath } from './content-path';
import { GATED_PATHS } from './seo';

// DAR-148. The two halves of `contentPath` are tested SEPARATELY because each accepts everything the
// other rejects: deleting the segment check leaves the EXTRA_SEGMENTS table green under the
// round-trip, and deleting the round-trip leaves the ESCAPES table green under the segment check.
// One merged table would pass with either half missing, which is the whole failure this guards.

const SECTION = '/news';

// Single-segment strings that `new URL` resolves somewhere ELSE. Every one is one segment, so the
// segment check waves them through — only the round-trip stops them.
const ESCAPES: { slug: string; resolvesTo: string; why: string }[] = [
	{ slug: '../admin', resolvesTo: '/admin', why: 'the defect DAR-148 was filed for' },
	{
		slug: '../../admin',
		resolvesTo: '/admin',
		why: 'climbing past the root is clamped, not refused'
	},
	{
		slug: '..\\admin',
		resolvesTo: '/admin',
		why: 'the URL parser folds `\\` to `/` in a special-scheme URL'
	},
	{ slug: '..', resolvesTo: '/', why: 'the section itself' },
	{ slug: '.', resolvesTo: '/news/', why: 'the section index under another spelling' }
];

// Round-trip-clean, so the check above accepts them — and none is a path `[slug]` can serve.
const EXTRA_SEGMENTS: { slug: string; why: string }[] = [
	{ slug: '', why: 'resolves to /news/ — the section index, listed a second time' },
	{ slug: 'a/b', why: '[slug] matches ONE segment' },
	{ slug: '/admin', why: 'reads as an escape and is really /news//admin — either way, a 404' },
	{ slug: '//evil.com/x', why: 'stays on-origin as /news///evil.com/x, but nothing serves it' }
];

// A query or fragment ends the pathname, so what is emitted is not what was asked for.
const DELIMITED = ['foo?x=1', 'foo#frag'];

// Unusual, and every one of them routable. The guard must refuse the unroutable, never the merely
// odd — `a&b<c` in particular is the sitemap spec's only case exercising XML escaping.
const ROUTABLE = [
	'michael-harris',
	'a&b<c',
	'café',
	'ada lovelace',
	'a.b',
	"o'brien",
	'2026-07-29'
];

describe('contentPath', () => {
	// The floor: without this proving `new URL` really does resolve these, the ESCAPES table would be
	// a list of strings nobody has shown to be dangerous, and a guard against nothing passes trivially.
	it.each(ESCAPES)('$slug escapes /news through `new URL` — $why', ({ slug, resolvesTo }) => {
		expect(new URL(`${SECTION}/${slug}`, 'https://darcstar.tech').pathname).toBe(resolvesTo);
	});

	it.each(ESCAPES)('refuses $slug, which resolves to $resolvesTo', ({ slug }) => {
		expect(contentPath(SECTION, slug)).toBeUndefined();
	});

	it.each(EXTRA_SEGMENTS)('refuses $slug — $why', ({ slug }) => {
		expect(contentPath(SECTION, slug)).toBeUndefined();
	});

	it.each(DELIMITED)('refuses %s, whose query or fragment ends the path', (slug) => {
		expect(contentPath(SECTION, slug)).toBeUndefined();
	});

	it.each([null, undefined])('refuses %s, the shape a missing slug arrives in', (slug) => {
		expect(contentPath(SECTION, slug)).toBeUndefined();
	});

	// Byte-for-byte: this returns the RAW path, leaving percent-encoding to whoever builds the URL
	// (localizeHref for an href, `new URL` for an @id, escapeXml for a <loc>). Re-encoding here would
	// make the three spellings disagree — precisely what DAR-122's `@id` note forbids.
	it.each(ROUTABLE)('passes %s through unchanged', (slug) => {
		expect(contentPath(SECTION, slug)).toBe(`${SECTION}/${slug}`);
	});

	it('composes the section it is given, not a hardcoded one', () => {
		expect(contentPath('/research', 'intelligence-ratchet')).toBe('/research/intelligence-ratchet');
		expect(contentPath('/people', 'michael-harris')).toBe('/people/michael-harris');
	});

	// The invariant in the language seo.e2e.ts states it in, from the same list it reads: no slug of
	// any spelling turns a content section into a gated path. Derived, so a gated route added later is
	// covered here the day it joins that list.
	it('cannot be talked into any gated path', () => {
		expect(GATED_PATHS.length).toBeGreaterThan(0);
		for (const gated of GATED_PATHS) {
			for (const section of ['/news', '/research', '/people']) {
				const depth = section.split('/').length - 1;
				// `../` repeated enough to climb out of the section, then the gated path.
				const slug = `${'../'.repeat(depth)}${gated.slice(1)}`;
				expect(
					contentPath(section, slug),
					`${section}/${slug} must not become a path`
				).toBeUndefined();
			}
		}
	});
});
