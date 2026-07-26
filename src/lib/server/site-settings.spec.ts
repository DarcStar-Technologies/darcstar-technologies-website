import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This read sits on the request path of EVERY page (the footer is in the root layout), so the three
// properties that keep it from being a site-wide liability — cache, timeout, floor — are the ones
// worth pinning. None of them are observable from the component or e2e side: a missing cache is
// invisible until traffic arrives, and a missing timeout is invisible until Sanity hangs.

const fetchMock = vi.fn();
vi.mock('./sanity', () => ({ getSanityClient: () => ({ fetch: fetchMock }) }));

const { getSocialLinks, resetSiteSettingsCache } = await import('./site-settings');

const CMS = [
	{ label: 'GitHub', url: 'https://github.com/DarcStar-Technologies' },
	{ label: 'BlueSky', url: 'https://bsky.app/profile/darcstar-tech.bsky.social' }
];
const FLOOR = [{ label: 'GitHub', url: 'https://github.com/DarcStar-Technologies' }];

const START = new Date('2026-07-26T00:00:00Z');

/** Move the clock without touching real timers — the TTLs are `Date.now()` comparisons. */
function advance(ms: number) {
	vi.setSystemTime(new Date(START.getTime() + ms));
}

beforeEach(() => {
	resetSiteSettingsCache();
	fetchMock.mockReset();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('getSocialLinks', () => {
	it('returns the sanitized CMS list', async () => {
		fetchMock.mockResolvedValue({ socialLinks: CMS });
		await expect(getSocialLinks()).resolves.toEqual(CMS);
	});

	it('passes an abort signal so a hung Sanity cannot stall every page', async () => {
		fetchMock.mockResolvedValue({ socialLinks: CMS });
		await getSocialLinks();

		const signal = fetchMock.mock.calls[0][2]?.signal;
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal.aborted).toBe(false);
		// NOTE: this pins that a signal is passed at all — the realistic regression, someone tidying
		// the fetch call. It does NOT pin the duration; a wrong timeout value would still pass here.
	});

	it('serves repeat calls from the cache instead of refetching', async () => {
		fetchMock.mockResolvedValue({ socialLinks: CMS });
		await getSocialLinks();
		advance(60_000);
		await expect(getSocialLinks()).resolves.toEqual(CMS);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('refetches once the success window expires', async () => {
		fetchMock.mockResolvedValue({ socialLinks: CMS });
		await getSocialLinks();
		advance(5 * 60_000 + 1);
		await getSocialLinks();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('collapses concurrent misses into one fetch', async () => {
		fetchMock.mockResolvedValue({ socialLinks: CMS });
		await Promise.all([getSocialLinks(), getSocialLinks(), getSocialLinks()]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		['the read throws', () => fetchMock.mockRejectedValue(new Error('sanity down'))],
		['the document is missing', () => fetchMock.mockResolvedValue(null)],
		['the array is empty', () => fetchMock.mockResolvedValue({ socialLinks: [] })],
		[
			'every entry is unusable',
			() => fetchMock.mockResolvedValue({ socialLinks: [{ label: 'X', url: 'javascript:1' }] })
		]
	])('falls back to the site constant when %s', async (_why, arrange) => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		arrange();
		// Never throws: an outage must degrade the footer, not 500 the page.
		await expect(getSocialLinks()).resolves.toEqual(FLOOR);
	});

	// A failure caches too, but briefly. Without that, an outage buys EVERY request the full timeout
	// — a cosmetic degradation turned into a latency incident.
	it('retries sooner after a failure than after a success', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		fetchMock.mockRejectedValue(new Error('sanity down'));
		await getSocialLinks();

		advance(29_000);
		await getSocialLinks();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		advance(31_000);
		fetchMock.mockResolvedValue({ socialLinks: CMS });
		await expect(getSocialLinks()).resolves.toEqual(CMS);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// A successful read that finds no document is a real answer, not an outage — it must NOT be stuck
	// on the short retry window, or a site with no siteSettings would refetch every 30 seconds forever.
	it('caches an empty answer for the full success window', async () => {
		fetchMock.mockResolvedValue(null);
		await getSocialLinks();
		advance(60_000);
		await getSocialLinks();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
