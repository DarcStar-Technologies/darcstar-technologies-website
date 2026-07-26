import { siteSettingsQuery } from '$lib/sanity/queries';
import { FALLBACK_SOCIAL_LINKS, resolveSocialLinks, type SocialLink } from '$lib/social-links';
import { getSanityClient } from './sanity';

// The `siteSettings` read behind the root layout (DAR-73). Unlike every other Sanity read on this
// site, this one is on the request path of EVERY page — the footer renders it, and the footer is in
// `+layout.svelte`, so this fetch also lands on /admin, /login and every form POST. Three properties
// make that affordable, and all three are load-bearing rather than polish:
//
//   1. TTL CACHE. Module scope, so it survives across requests in a warm Workers isolate — roughly
//      one fetch per isolate per TTL, not one per request. The same trick on per-user data would be
//      a cross-request leak; it's safe here ONLY because `siteSettings` is public, anonymous-readable
//      and identical for every visitor. (Same reasoning as the `session.cookieCache` 5-min window.)
//   2. TIMEOUT. Without it a hung Sanity stalls every page on the site, not one route.
//   3. FLOOR. Any failure — throw, timeout, missing document, all-junk array — resolves to
//      FALLBACK_SOCIAL_LINKS instead of erroring the page. This is the posture the LIST loads take
//      (`try/catch` → empty state, never a 500), except site chrome degrades to the known-good link
//      rather than to nothing.
//
// Failures are cached too, for a shorter window: without that, a Sanity outage would buy every
// request the full timeout, turning a cosmetic degradation into a site-wide latency incident.

const SUCCESS_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_000;

// `readonly` on the way out: this array is handed to every render until the TTL lapses, so a
// caller mutating it would poison the footer site-wide until the next refresh.
let cached: { links: readonly SocialLink[]; expiresAt: number } | undefined;
// Collapses a thundering herd on a cold isolate: concurrent misses await ONE fetch.
let inFlight: Promise<readonly SocialLink[]> | undefined;

/**
 * The site's social profile row, CMS-driven. Never throws and never returns an empty array — see
 * the floor above. Sanitization lives in `$lib/social-links.ts` so the server and the component's
 * default can't disagree about what a usable link is.
 */
export async function getSocialLinks(): Promise<readonly SocialLink[]> {
	if (cached && Date.now() < cached.expiresAt) return cached.links;
	inFlight ??= readSocialLinks().finally(() => {
		inFlight = undefined;
	});
	return inFlight;
}

async function readSocialLinks(): Promise<readonly SocialLink[]> {
	let links = [...FALLBACK_SOCIAL_LINKS];
	let ttl = FAILURE_TTL_MS;

	try {
		const settings = await getSanityClient().fetch(
			siteSettingsQuery,
			{},
			// AbortSignal.timeout is supported on workerd; a fresh signal per attempt (a shared one
			// would already be aborted on the second call).
			{ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
		);
		links = resolveSocialLinks(settings?.socialLinks);
		// A read that succeeded but found no document is a real answer, not a failure — it caches
		// for the full window. Only an error or timeout gets the short retry.
		ttl = SUCCESS_TTL_MS;
	} catch (error) {
		console.warn(
			'[site-settings] socialLinks read failed — falling back to the site constant',
			error
		);
	}

	cached = { links, expiresAt: Date.now() + ttl };
	return links;
}

/** Test seam: drop the module-level cache between cases. Not used by app code. */
export function resetSiteSettingsCache(): void {
	cached = undefined;
	inFlight = undefined;
}
