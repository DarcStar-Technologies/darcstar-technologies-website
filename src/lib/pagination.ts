// Page-window arithmetic for the content indexes (/research, /news — DAR-94). Pure functions, so
// the parse/clamp/href rules are unit-testable without a DOM or a Sanity round trip; the loads and
// the Pager component both read from here rather than each doing their own off-by-one.
//
// `?page=` is deliberately NOT part of `FILTER_PARAM` ($lib/research-filters.ts). That is what makes
// "changing a filter resets to page 1" fall out of the existing machinery instead of needing a rule:
// `buildFilterQuery` only ever emits keys it finds in `FILTER_PARAM`, and the no-JS path is a native
// GET form, which replaces the whole query string with its own fields. Neither can carry a stale
// page forward. (Pinned in research-filters.spec.ts — a future `page` entry in `FILTER_PARAM` would
// silently keep a visitor on page 7 of a filter that now has two results.)

export const PAGE_PARAM = 'page';

/** Rows per page on both indexes. */
export const PAGE_SIZE = 20;

// A ceiling on the PARSED page number, before any clamp against the real total. Not a UX limit —
// `pageWindow` clamps to the real page count and the load redirects — but the requested page becomes
// a GROQ slice bound, and `?page=1e21` would otherwise send Sanity a non-safe-integer offset. Junk
// belongs to the parser, not to the query.
const MAX_PAGE = 100_000;

export interface PageWindow {
	/** 1-based, clamped into range. */
	page: number;
	/** Always at least 1, so an empty index is "page 1 of 1" rather than "of 0". */
	pageCount: number;
	/** GROQ slice start, 0-based. */
	offset: number;
	/** GROQ slice end, exclusive. */
	end: number;
	/** 1-based index of the first row shown (0 when there are none). */
	from: number;
	/** 1-based index of the last row shown (0 when there are none). */
	to: number;
	/** The caller asked for a page past the end — the load answers with a redirect. */
	outOfRange: boolean;
}

/**
 * `?page=` → a 1-based page number. Tolerant in the same posture as `parseResearchFilters`: absent,
 * empty, non-numeric, zero, negative and absurd values all degrade to page 1 rather than erroring.
 * `^\d+$` rather than `parseInt`, so "2abc" is junk (→ 1) instead of silently meaning 2.
 */
export function parsePageParam(params: URLSearchParams): number {
	const raw = params.get(PAGE_PARAM);
	if (!raw || !/^\d+$/.test(raw)) return 1;
	const n = Number(raw);
	return Math.min(Math.max(n, 1), MAX_PAGE);
}

/**
 * The GROQ slice start for a page. Exists because a load has to build the slice BEFORE it knows the
 * total — the total arrives in the same response as the rows — so it cannot go through
 * `pageWindow`. Keeping the arithmetic in one place is the point: the two used to be written out
 * separately, which is one edit away from a load fetching a different page than the pager labels.
 */
export function pageOffset(page: number, pageSize = PAGE_SIZE): number {
	return (Math.max(Math.floor(page) || 1, 1) - 1) * pageSize;
}

/** Resolves a requested page against a known total. `total` comes from the same query as the rows. */
export function pageWindow(requested: number, total: number, pageSize = PAGE_SIZE): PageWindow {
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(Math.max(Math.floor(requested) || 1, 1), pageCount);
	const offset = pageOffset(page, pageSize);
	return {
		page,
		pageCount,
		offset,
		end: offset + pageSize,
		from: total === 0 ? 0 : offset + 1,
		to: Math.min(offset + pageSize, total),
		outOfRange: requested > pageCount
	};
}

/**
 * This page's URL with `?page=` set to `page`, preserving every other param — so a pager link keeps
 * the visitor's filters and sort. Page 1 drops the param entirely, keeping the canonical URL clean
 * (`/research`, never `/research?page=1`).
 *
 * Built from `url.pathname`, NOT `localizeHref`: the pathname is already the localized one the
 * visitor is on (`/es/research`), so re-localizing would double the prefix. Same reasoning as
 * `applyFilters` in the /research page.
 */
export function pageHref(url: URL, page: number): string {
	const params = new URLSearchParams(url.searchParams);
	if (page <= 1) params.delete(PAGE_PARAM);
	else params.set(PAGE_PARAM, String(page));
	const query = params.toString();
	return query ? `${url.pathname}?${query}` : url.pathname;
}
