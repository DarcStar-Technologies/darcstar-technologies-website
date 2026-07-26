import { describe, expect, it } from 'vitest';
import { FALLBACK_SOCIAL_LINKS, resolveSocialLinks, socialIconKey } from './social-links';
import { GITHUB_URL } from './site';

// DAR-73 turned the footer's social row and the Organization `sameAs` into CMS data. Two rules carry
// the risk: the floor (this surface is on EVERY page, so "Sanity said nothing" must not render an
// empty row) and the URL gate (these are `target="_blank"` hrefs AND published machine-readable
// identities, from a field whose Studio validation an API write skips).

describe('resolveSocialLinks', () => {
	it('keeps usable entries in editor order', () => {
		expect(
			resolveSocialLinks([
				{ label: 'GitHub', url: 'https://github.com/DarcStar-Technologies' },
				{ label: 'LinkedIn', url: 'https://www.linkedin.com/company/darcstar-technologies' },
				{ label: 'BlueSky', url: 'https://bsky.app/profile/darcstar-tech.bsky.social' }
			])
		).toEqual([
			{ label: 'GitHub', url: 'https://github.com/DarcStar-Technologies' },
			{ label: 'LinkedIn', url: 'https://www.linkedin.com/company/darcstar-technologies' },
			{ label: 'BlueSky', url: 'https://bsky.app/profile/darcstar-tech.bsky.social' }
		]);
	});

	it('trims stray whitespace around the label and URL', () => {
		expect(resolveSocialLinks([{ label: '  GitHub  ', url: '  https://github.com/x  ' }])).toEqual([
			{ label: 'GitHub', url: 'https://github.com/x' }
		]);
	});

	it.each([
		['no label', { label: null, url: 'https://github.com/x' }],
		['a blank label', { label: '   ', url: 'https://github.com/x' }],
		['no URL', { label: 'GitHub', url: null }],
		['a relative URL', { label: 'GitHub', url: '/github' }],
		['a mailto: URL', { label: 'Email', url: 'mailto:info@darcstar.tech' }],
		['a javascript: URL', { label: 'Oops', url: 'javascript:alert(1)' }],
		// `new URL` percent-encodes spaces, so a prose-filled field parses as a well-formed 404 —
		// the same trap DAR-70 hit with a hand-typed DOI. isHttpUrl rejects embedded whitespace.
		['prose instead of a URL', { label: 'GitHub', url: 'https://github.com/see our profile' }]
	])('drops an entry with %s', (_why, link) => {
		expect(resolveSocialLinks([link])).toEqual(FALLBACK_SOCIAL_LINKS);
	});

	it('drops only the bad entries, keeping the rest', () => {
		expect(
			resolveSocialLinks([
				{ label: 'Broken', url: 'not-a-url' },
				{ label: 'BlueSky', url: 'https://bsky.app/profile/x' },
				null
			])
		).toEqual([{ label: 'BlueSky', url: 'https://bsky.app/profile/x' }]);
	});

	it('dedupes repeated URLs, keeping the first', () => {
		expect(
			resolveSocialLinks([
				{ label: 'GitHub', url: 'https://github.com/x' },
				{ label: 'GitHub (again)', url: 'https://github.com/x' }
			])
		).toEqual([{ label: 'GitHub', url: 'https://github.com/x' }]);
	});

	it.each([
		['null', null],
		['undefined', undefined],
		['an empty array', []]
	])('falls back to the site constant for %s', (_why, links) => {
		expect(resolveSocialLinks(links)).toEqual([{ label: 'GitHub', url: GITHUB_URL }]);
	});

	// The asymmetry that makes the CMS honest in BOTH directions: an editor who removes the GitHub
	// entry must see it disappear. A floor that merged in would make deletion impossible.
	it('does not merge the floor into a non-empty result', () => {
		const resolved = resolveSocialLinks([{ label: 'LinkedIn', url: 'https://linkedin.com/x' }]);
		expect(resolved).toEqual([{ label: 'LinkedIn', url: 'https://linkedin.com/x' }]);
		expect(resolved.map((link) => link.url)).not.toContain(GITHUB_URL);
	});

	// The fallback is module-level state shared with the Footer's prop default — handing callers the
	// array itself would let one mutation poison every later render.
	it('returns a copy of the fallback, not the shared array', () => {
		const resolved = resolveSocialLinks([]);
		resolved.push({ label: 'Injected', url: 'https://example.com' });
		expect(FALLBACK_SOCIAL_LINKS).toHaveLength(1);
	});
});

describe('socialIconKey', () => {
	it.each([
		['https://github.com/DarcStar-Technologies', 'github'],
		['https://www.linkedin.com/company/darcstar-technologies', 'linkedin'],
		['https://linkedin.com/company/x', 'linkedin'],
		['https://bsky.app/profile/darcstar-tech.bsky.social', 'bluesky']
	])('maps %s to the %s mark', (url, key) => {
		expect(socialIconKey(url)).toBe(key);
	});

	it.each([
		['a platform we ship no mark for', 'https://mastodon.social/@darcstar'],
		['an unparseable URL', 'not-a-url'],
		// Substring matching would hand this the GitHub mark; the host must match exactly or as a
		// subdomain.
		['a lookalike host', 'https://evil-github.com/DarcStar-Technologies']
	])('falls back to the generic glyph for %s', (_why, url) => {
		expect(socialIconKey(url)).toBe('link');
	});

	// Host matching is case-insensitive; URLs are not otherwise normalized.
	it('ignores host casing', () => {
		expect(socialIconKey('https://GitHub.com/x')).toBe('github');
	});
});
