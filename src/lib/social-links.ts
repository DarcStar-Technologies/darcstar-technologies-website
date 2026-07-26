import { GITHUB_URL } from '$lib/site';
import { isHttpUrl } from '$lib/jsonld';

// The site's social profile row (DAR-73) — CMS-driven, with a constant floor.
//
// Until this, the footer and the Organization `sameAs` both rendered the single hardcoded
// `GITHUB_URL`, while the Studio's `siteSettings.socialLinks` — where LinkedIn and BlueSky had
// already been published AND promoted — reached nothing. This module is the one place that turns
// that CMS array into something renderable, so the footer, the JSON-LD, and their tests all agree.
//
// Pure and client-safe (constants + `isHttpUrl`): the Footer imports it directly for its default,
// and the server reader ($lib/server/site-settings.ts) runs the same function on fetched data, so
// there is no second sanitization path to drift.

export interface SocialLink {
	label: string;
	url: string;
}

/**
 * What renders when the CMS says nothing usable — a Sanity outage, a token-less checkout, an empty
 * or all-junk array. Deliberately the SAME GitHub URL `$lib/site.ts` already exports for the About
 * page and the contact card, so the floor can't drift from the rest of the site's idea of "our
 * GitHub". A footer with no social links at all would be a visible regression, and this surface is
 * on every page, so degrading to the one link we're certain of beats degrading to nothing.
 *
 * `readonly` because it is module state that doubles as the Footer's prop default: one stray
 * `.push()` anywhere would poison every later render on every page. Callers that need a mutable
 * list spread it.
 */
export const FALLBACK_SOCIAL_LINKS: readonly SocialLink[] = [{ label: 'GitHub', url: GITHUB_URL }];

/** The shape Sanity hands back — every field nullable, per TypeGen. */
interface RawSocialLink {
	label?: string | null;
	url?: string | null;
}

/**
 * Sanitize the CMS array into renderable links, or fall back to the floor.
 *
 * Entries need BOTH a label (it becomes the button's accessible name) and an absolute http(s) URL.
 * The `isHttpUrl` gate is shared with DAR-70's canonical derivation for the same reason it exists
 * there: the Studio validates this field with `rule.uri({scheme: ['http', 'https']})`, but that is a
 * UI affordance an API write skips, and these URLs are rendered with `target="_blank"` AND published
 * as the Organization's `sameAs` identities — a `javascript:` href or a percent-encoded sentence is
 * worse here than the garbage-in-JSON-LD case that gate was written for.
 *
 * The floor applies ONLY when nothing survives — it is never merged into a non-empty result. That
 * asymmetry is the point: an editor who deletes the GitHub entry must actually see it disappear,
 * or the CMS is lying again in the other direction.
 */
export function resolveSocialLinks(
	links: readonly (RawSocialLink | null)[] | null | undefined
): SocialLink[] {
	const seen = new Set<string>();
	const resolved: SocialLink[] = [];

	for (const link of links ?? []) {
		const label = link?.label?.trim();
		const url = link?.url?.trim();
		if (!label || !url || !isHttpUrl(url)) continue;
		// Two array entries pointing at the same profile would render as duplicate buttons and a
		// repeated `sameAs` entry. Keep the first, so editor order still decides.
		if (seen.has(url)) continue;
		seen.add(url);
		resolved.push({ label, url });
	}

	return resolved.length > 0 ? resolved : [...FALLBACK_SOCIAL_LINKS];
}

/** Which glyph a link gets in the footer. `link` is the generic fallback. */
export type SocialIconKey = 'github' | 'linkedin' | 'bluesky' | 'link';

// Keyed on the registrable domain, NOT the editor's free-text label: "Linked In", "LinkedIn (company)"
// and a typo all still resolve to the right mark, and a renamed label can't silently drop the icon.
const ICON_DOMAINS: Record<string, SocialIconKey> = {
	'github.com': 'github',
	'linkedin.com': 'linkedin',
	'bsky.app': 'bluesky'
};

/**
 * Map a profile URL to its brand glyph, or `link` for anything we don't ship a mark for — so adding
 * a platform in the CMS renders a generic-but-correct button rather than an empty one.
 *
 * Matches the host exactly or as a subdomain (`www.linkedin.com`), never as a substring: a
 * `endsWith('github.com')` test would also match `evil-github.com`.
 */
export function socialIconKey(url: string): SocialIconKey {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return 'link';
	}
	for (const [domain, key] of Object.entries(ICON_DOMAINS)) {
		if (host === domain || host.endsWith(`.${domain}`)) return key;
	}
	return 'link';
}
