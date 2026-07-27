import { beforeEach, describe, expect, it, vi } from 'vitest';

// The endpoint's job is a lookup, and its ONE boundary is that it refuses to answer a query too
// short to narrow anything. That refusal has to happen before Sanity is touched, so these tests
// assert on whether the client was CALLED — a test that only checked the response body would pass
// against a version that dumped the vocabulary and then sliced it in JS.
const fetchSpy = vi.fn();
vi.mock('$lib/server/sanity', () => ({ getSanityClient: () => ({ fetch: fetchSpy }) }));

const { GET } = await import('./+server');

// Only `url` is read; the rest of RequestEvent is irrelevant here.
const call = (search: string) =>
	(GET as (event: { url: URL }) => Promise<Response>)({
		url: new URL(`https://darcstar.tech/research/authors.json${search}`)
	});

beforeEach(() => {
	fetchSpy.mockReset();
	fetchSpy.mockResolvedValue([{ value: 'tri-dao', label: 'Tri Dao' }]);
});

describe('GET /research/authors.json', () => {
	it('returns matching authors for a usable query', async () => {
		const res = await call('?q=dao');
		expect(await res.json()).toEqual({ authors: [{ value: 'tri-dao', label: 'Tri Dao' }] });
		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(fetchSpy.mock.calls[0][1]).toEqual({ q: 'dao' });
	});

	// THE guard. Measured against production, `name match ("" + "*")` and `name match ("*" + "*")`
	// each return ALL 123 people in the dataset — so an unfiltered term turns this lookup into a dump
	// of the entire author vocabulary, which is the exact payload the text-input control exists to
	// keep off the page. The browser applies the same floor, but nothing stops a caller from
	// requesting this directly, so the server has to be the one that means it.
	it.each([
		['no query at all', ''],
		['an empty query', '?q='],
		['one character', '?q=d'],
		['two characters', '?q=da'],
		['whitespace', '?q=%20%20%20'],
		['a bare wildcard', '?q=*'],
		['wildcards that clean down to nothing', '?q=**'],
		['a short term padded with a wildcard', '?q=da*']
	])('never reaches Sanity for %s', async (_label, search) => {
		const res = await call(search);
		expect(await res.json()).toEqual({ authors: [] });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	// Wildcards are stripped rather than rejected — someone typing `Dao*` means Dao — but they must
	// not reach the `match` pattern, where they would widen it back out.
	it('strips wildcards before they reach the match pattern', async () => {
		await call('?q=Dao*');
		expect(fetchSpy.mock.calls[0][1]).toEqual({ q: 'Dao' });
	});

	// Same posture as the list loads: an outage costs suggestions, never the ability to filter (the
	// filter itself is server-side — the visitor can still type a name and submit).
	it('degrades to no suggestions when Sanity is unreachable', async () => {
		fetchSpy.mockRejectedValue(new Error('sanity down'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const res = await call('?q=dao');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ authors: [] });
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('lets a debounced type-ahead be cached rather than re-asked per keystroke', async () => {
		const res = await call('?q=dao');
		expect(res.headers.get('cache-control')).toContain('public');
	});
});
