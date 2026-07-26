import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Footer from './Footer.svelte';
import { GITHUB_URL } from '$lib/site';

// The footer's social row is CMS-driven (DAR-73). It renders on every page, so the two things worth
// pinning are the ones a regression would make site-wide: that the passed list actually reaches the
// markup, in order, with safe external-link attributes — and that a caller with no data still gets
// the floor rather than an empty row.

const CMS_LINKS = [
	{ label: 'GitHub', url: 'https://github.com/DarcStar-Technologies' },
	{ label: 'LinkedIn', url: 'https://www.linkedin.com/company/darcstar-technologies' },
	{ label: 'BlueSky', url: 'https://bsky.app/profile/darcstar-tech.bsky.social' }
];

/** The social buttons, in DOM order — they're the footer's only new-tab links. */
function socialHrefs(container: HTMLElement): string[] {
	return [...container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')].map(
		(anchor) => anchor.getAttribute('href') ?? ''
	);
}

describe('Footer social links', () => {
	it('renders the CMS links in editor order', () => {
		const { container } = render(Footer, { socialLinks: CMS_LINKS });
		expect(socialHrefs(container)).toEqual(CMS_LINKS.map((link) => link.url));
	});

	it('uses the CMS label as the accessible name', async () => {
		render(Footer, { socialLinks: CMS_LINKS });
		for (const link of CMS_LINKS) {
			// An icon-only button has no other accessible name — a dropped label would leave these
			// unreachable by assistive tech.
			await expect
				.element(page.getByRole('link', { name: link.label }))
				.toHaveAttribute('href', link.url);
		}
	});

	it('opens external profiles safely', async () => {
		render(Footer, { socialLinks: CMS_LINKS });
		const linkedin = page.getByRole('link', { name: 'LinkedIn' });
		await expect.element(linkedin).toHaveAttribute('target', '_blank');
		await expect.element(linkedin).toHaveAttribute('rel', 'noreferrer');
	});

	it('falls back to the site GitHub link when given nothing', () => {
		const { container } = render(Footer);
		expect(socialHrefs(container)).toEqual([GITHUB_URL]);
	});

	// The mailto is a contact route, not a social profile — it is never CMS-driven and must survive
	// whatever the CMS list holds.
	it('keeps the email button independent of the CMS list', async () => {
		render(Footer, { socialLinks: [{ label: 'BlueSky', url: 'https://bsky.app/profile/x' }] });
		await expect
			.element(page.getByRole('link', { name: 'Email' }))
			.toHaveAttribute('href', 'mailto:info@darcstar.tech');
	});
});
