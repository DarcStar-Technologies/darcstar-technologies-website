import { describe, expect, it } from 'vitest';
import { contentPath } from './content-path';
import { GATED_PATHS } from './seo';

// DAR-148. `contentPath` asks two questions and they OVERLAP — the headline case `../admin` contains
// a slash, so the segment check alone already refuses it. That overlap is why the tables below are
// split by WHICH HALF IS EXCLUSIVELY RESPONSIBLE rather than by what the slug looks like: a single
// merged table of "bad slugs" stays green with either half deleted, which is precisely the
// regression this file exists to catch. Both directions are mutation-measured.

const SECTION = '/news';

// What the guard is FOR: strings `new URL` resolves somewhere else entirely. Not split by half — the
// point of this table is that these are real escapes, whichever check happens to stop them.
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

// Slash-free, so the segment check waves every one of them through. Deleting the round-trip is
// exactly the mutation these rows exist to fail — and `..\admin` shows the stake: a full escape into
// the staff area that "one segment" cannot see, because it contains no slash.
const ONLY_ROUND_TRIP: { slug: string; why: string }[] = [
	{ slug: '..\\admin', why: 'the URL parser folds `\\` to `/`, so this IS ../admin' },
	{ slug: '..', why: 'resolves to the site root' },
	{ slug: '.', why: 'resolves to the section index' },
	{ slug: 'foo?x=1', why: 'the query ends the path — what is emitted is not what was asked for' },
	{ slug: 'foo#frag', why: 'likewise the fragment' }
];

// The mirror: each of these round-trips CLEANLY (parse it, print it, same string), so only "one
// segment" refuses them. None names a path `[slug]` can serve.
const ONLY_SEGMENT: { slug: string; why: string }[] = [
	{ slug: '', why: 'resolves to /news/ — the section index, listed a second time' },
	{ slug: 'a/b', why: '[slug] matches ONE segment' },
	{ slug: '/admin', why: 'reads as an escape and is really /news//admin — either way, a 404' },
	{ slug: '//evil.com/x', why: 'stays on-origin as /news///evil.com/x, but nothing serves it' }
];

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

	// Each of these has NO slash, so it survives the segment check and only the round-trip stops it.
	it.each(ONLY_ROUND_TRIP)('refuses $slug — $why', ({ slug }) => {
		expect(slug, 'this row belongs in ONLY_SEGMENT if it has a slash').not.toContain('/');
		expect(contentPath(SECTION, slug)).toBeUndefined();
	});

	// And each of these round-trips cleanly, so only the segment check stops it. The paired assertion
	// keeps the table honest: a row that stops being round-trip-clean would quietly move its coverage
	// to the other half, leaving the segment check untested while the test still passed.
	it.each(ONLY_SEGMENT)('refuses $slug — $why', ({ slug }) => {
		const path = `${SECTION}/${slug}`;
		const resolved = new URL(path, 'https://darcstar.tech');
		expect(resolved.pathname, 'this row belongs in ONLY_ROUND_TRIP').toBe(encodeURI(path));
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
