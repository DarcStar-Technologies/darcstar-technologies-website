import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, pageHref, pageOffset, pageWindow, parsePageParam } from './pagination';

const params = (search: string) => new URLSearchParams(search);

describe('parsePageParam', () => {
	it('reads a 1-based page number', () => {
		expect(parsePageParam(params('page=3'))).toBe(3);
	});

	// The tolerant posture parseResearchFilters established: a hand-edited or stale URL must render
	// page 1, never throw and never reach GROQ as a junk slice bound.
	it.each([
		['absent', ''],
		['empty', 'page='],
		['non-numeric', 'page=abc'],
		['partly numeric', 'page=2abc'],
		['zero', 'page=0'],
		['negative', 'page=-4'],
		['fractional', 'page=1.5'],
		['exponent form', 'page=1e9']
	])('falls back to page 1 when the param is %s', (_label, search) => {
		expect(parsePageParam(params(search))).toBe(1);
	});

	// `?page=1e21` would otherwise become a non-safe-integer GROQ offset. The clamp is the parser's
	// job — pageWindow still narrows this to the real page count.
	it('caps an absurd page number at a safe integer', () => {
		const parsed = parsePageParam(params('page=999999999999999999999'));
		expect(Number.isSafeInteger(parsed)).toBe(true);
		expect(parsed).toBe(100_000);
	});
});

describe('pageWindow', () => {
	it('describes the first page of a multi-page set', () => {
		expect(pageWindow(1, 137, 20)).toEqual({
			page: 1,
			pageCount: 7,
			offset: 0,
			end: 20,
			from: 1,
			to: 20,
			outOfRange: false
		});
	});

	it('describes a middle page', () => {
		expect(pageWindow(3, 137, 20)).toMatchObject({ page: 3, offset: 40, from: 41, to: 60 });
	});

	// The last page is short — `to` must be the total, not the slice end, or the count line claims
	// rows that aren't there.
	it('stops the last page at the total rather than the slice end', () => {
		expect(pageWindow(7, 137, 20)).toMatchObject({ page: 7, offset: 120, from: 121, to: 137 });
	});

	it('clamps a page past the end and flags it for the redirect', () => {
		expect(pageWindow(99, 137, 20)).toMatchObject({ page: 7, outOfRange: true });
	});

	// An empty index is "page 1 of 1", never "of 0" — the Pager renders nothing at pageCount 1, so a
	// zero would only be a way to print "Page 1 of 0" somewhere.
	it('treats an empty result set as a single empty page', () => {
		expect(pageWindow(1, 0, 20)).toMatchObject({
			page: 1,
			pageCount: 1,
			from: 0,
			to: 0,
			outOfRange: false
		});
	});

	it('does not flag page 1 as out of range on an empty set', () => {
		expect(pageWindow(1, 0).outOfRange).toBe(false);
	});

	it('fits an exactly-full page without inventing an empty one', () => {
		expect(pageWindow(1, 20, 20)).toMatchObject({ pageCount: 1, from: 1, to: 20 });
	});

	it('defaults to the shared PAGE_SIZE', () => {
		expect(pageWindow(2, 100).offset).toBe(PAGE_SIZE);
	});
});

describe('pageOffset', () => {
	it('is 0 for the first page', () => {
		expect(pageOffset(1, 20)).toBe(0);
	});

	it('steps by the page size', () => {
		expect(pageOffset(4, 20)).toBe(60);
	});

	// The load calls this BEFORE it knows the total, so it has to agree with pageWindow's own
	// arithmetic — otherwise the rows fetched and the range the count line prints come apart.
	it('agrees with pageWindow for every in-range page', () => {
		for (let page = 1; page <= 7; page++) {
			expect(pageOffset(page, 20)).toBe(pageWindow(page, 137, 20).offset);
		}
	});

	it('floors junk to the first page rather than producing a negative slice', () => {
		expect(pageOffset(0, 20)).toBe(0);
		expect(pageOffset(-3, 20)).toBe(0);
	});
});

describe('pageHref', () => {
	const url = (href: string) => new URL(href, 'https://darcstar.tech');

	// The whole point of the pager being plain anchors: a paged link must not silently drop the
	// filters the visitor set.
	it('preserves every other param', () => {
		expect(pageHref(url('/research?topic=long-context&sort=title'), 2)).toBe(
			'/research?topic=long-context&sort=title&page=2'
		);
	});

	it('replaces an existing page rather than appending a second one', () => {
		expect(pageHref(url('/research?page=4&topic=x'), 2)).toBe('/research?page=2&topic=x');
	});

	// Page 1 is the canonical URL — `?page=1` would be a second address for the same content.
	it('omits the param for page 1', () => {
		expect(pageHref(url('/research?page=4'), 1)).toBe('/research');
	});

	it('keeps other params when dropping page 1', () => {
		expect(pageHref(url('/research?page=4&topic=x'), 1)).toBe('/research?topic=x');
	});

	// The pathname is already locale-prefixed; re-localizing would produce /es/es/research.
	it('builds from the localized pathname it was given', () => {
		expect(pageHref(url('/es/research?topic=x'), 3)).toBe('/es/research?topic=x&page=3');
	});

	it('leaves a bare path bare', () => {
		expect(pageHref(url('/news'), 1)).toBe('/news');
	});
});
