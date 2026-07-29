// One rule, for every place a CMS slug becomes a URL (DAR-148): a slug the `[slug]` route cannot
// serve never becomes one.
//
// The defect this exists to close: `/news/${slug}` reaches the browser, the sitemap and the JSON-LD
// graph through `new URL`, which RESOLVES `../`. A `../admin` slug therefore emitted
// <loc>https://darcstar.tech/admin</loc> — a path seo.e2e.ts's GATED_PATHS asserts must never be in
// the sitemap, so a document could falsify a stated invariant. Nothing in CI could see it: e2e runs
// without SANITY_VIEWER_TOKEN (DAR-96), so no CMS-driven <loc> exists there at all.
//
// Zero imports, deliberately. `$lib/jsonld.ts` is a consumer and must stay DEPENDENCY-PURE (the root
// layout imports it, so anything it pulls in rides in every page's initial client bundle), which is
// also why this isn't a corner of that module.

/** Any absolute base works — only the resolved pathname is read, never the origin. */
const PROBE_ORIGIN = 'https://content-path.invalid';

/**
 * The path a `[slug]` route can actually serve — `/news/hello-world` — or `undefined`.
 *
 * TWO conditions, and each catches cases the other lets through (measured, not assumed):
 *
 *   - **One segment.** SvelteKit's `[slug]` matches a SINGLE path segment, so `a/b`, `/admin` and
 *     `//evil.com/x` name documents the route could not serve however they resolve; an empty slug
 *     resolves to `/news/`, a second spelling of the section index. The round-trip below accepts all
 *     four — it only asks whether the string survives parsing, not whether the result is routable.
 *   - **Round-trips.** `../admin` → `/admin`, `..\admin` → `/admin` (the URL parser folds `\` to `/`
 *     in a special-scheme URL), `..` → `/`, `foo?x=1` → a path plus a query. Each is a single
 *     segment, so the check above accepts every one of them.
 *
 * `encodeURI` rather than `encodeURIComponent` on the right-hand side: the comparison must accept a
 * slug that is merely UNUSUAL, only rejecting one that is unroutable. `encodeURIComponent` escapes
 * `&`, which would drop `a&b<c` — a slug the route serves fine, and the sitemap's only case
 * exercising its XML escaping.
 *
 * Dropping costs nothing real: every slug in the corpus is `[a-z0-9-]+`, and anything this refuses
 * addresses a page that would 404.
 */
export function contentPath(section: string, slug: string | null | undefined): string | undefined {
	if (!slug || slug.includes('/')) return undefined;
	const path = `${section}/${slug}`;
	const resolved = new URL(path, PROBE_ORIGIN);
	if (resolved.pathname !== encodeURI(path) || resolved.search || resolved.hash) return undefined;
	return path;
}
