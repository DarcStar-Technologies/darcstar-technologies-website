import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// CosmicBackdrop paints from the theme's --color-*-500 and `addColorStop('')` THROWS without the
// sheet — see the fuller note in /people/[slug]/page.svelte.spec.ts.
import '../../layout.css';
import type { PageData } from './$types';

// The related-papers list is the SIXTH place a CMS slug becomes a path, and it was missed by the
// first cut of DAR-148 — found by re-sweeping during review, not by any test, which is exactly why
// it gets one. It carried the same `{#if paper.slug}` truthiness check the ticket exists to replace,
// so a related paper slugged `../admin` put a link to the login wall on a public post page.
//
// Only assertable here: CI's e2e has no SANITY_VIEWER_TOKEN (DAR-96), so this route 404s there.
vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/news/hello-from-darcstar'),
		data: {},
		params: { slug: 'hello-from-darcstar' },
		route: {}
	}
}));

const { default: PostPage } = await import('./+page.svelte');

// This route's own load return only — `PageData` also carries the root layout's session half, which
// this page reads none of.
type PageFixture = Pick<PageData, 'post'>;
type Post = PageFixture['post'];
type RelatedPaper = NonNullable<Post['relatedPapers']>[number];

const PAPER: RelatedPaper = {
	_id: 'paper.ratchet',
	title: 'The Intelligence Ratchet',
	slug: 'intelligence-ratchet',
	venue: 'arXiv',
	darcstarAuthored: true,
	hasCommentary: false
};

const POST: Post = {
	_id: 'post.hello',
	_updatedAt: '2026-07-22T00:00:00Z',
	title: 'Hello from DarcStar',
	slug: 'hello-from-darcstar',
	excerpt: 'A first note.',
	publishedAt: '2026-07-22',
	coverImage: null,
	body: [],
	authors: [],
	categories: [],
	relatedPapers: [PAPER],
	seo: null
};

const mount = (relatedPapers: RelatedPaper[]) =>
	render(PostPage, { data: { post: { ...POST, relatedPapers } } as PageData });

const relatedLink = () => page.getByRole('link', { name: /The Intelligence Ratchet/ });

describe('/news/[slug] related papers', () => {
	it('links a related paper to its page', async () => {
		mount([PAPER]);
		await expect.element(relatedLink()).toHaveAttribute('href', '/research/intelligence-ratchet');
	});

	// The title and venue are separated by a space + `·` that exists ONLY as leading whitespace inside
	// the venue `<span>`, and Svelte trims whitespace at block and element boundaries — the trap that
	// produced `Ledger Rocket· 2025–Present` in DAR-122. No live post has related papers, so nothing
	// on the site renders this today and there is no production page to compare against; asserting the
	// collapsed text is the only thing standing between a reformat and `The Intelligence Ratchet·
	// arXiv` shipping unnoticed.
	it('keeps the space around the venue separator', async () => {
		const { container } = mount([PAPER]);
		const text = container.querySelector('li a')?.textContent?.replace(/\s+/g, ' ').trim();
		expect(text).toBe('The Intelligence Ratchet · arXiv');
	});

	// DAR-153 brought this into line with the site's six other separators. It is the only one INSIDE
	// a link, so unlike the rest it changes an accessible NAME — hence a name assertion rather than
	// just an attribute one: the punctuation goes, the venue stays, because the venue is content.
	// (`textContent` above still sees the dot, which is what keeps the two tests independent.)
	it('drops the separator from the link name but keeps the venue', async () => {
		mount([PAPER]);
		await expect
			.element(page.getByRole('link', { name: 'The Intelligence Ratchet arXiv', exact: true }))
			.toBeVisible();
	});

	it('hides the separator from assistive technology', () => {
		const { container } = mount([PAPER]);
		expect(container.querySelector('li a [aria-hidden="true"]')?.textContent).toBe('·');
	});

	// Both halves of the guard: `../admin` and `a/b` are refused by the segment check, `..\admin` only
	// by the URL round-trip (the parser folds `\` to `/`, so it escapes just as far without ever
	// containing a slash).
	it.each(['../admin', '..\\admin', '../../login', 'a/b', ''])(
		'drops a related paper slugged "%s" rather than linking it',
		async (slug) => {
			mount([{ ...PAPER, slug }]);
			expect(relatedLink().elements()).toHaveLength(0);
			// The whole row goes, not just the anchor: this row is nothing BUT a cross-reference, so a
			// title with no link would be a dead entry. Opposite call from the index cards, where the
			// card is the document's own listing.
			expect(page.getByText('The Intelligence Ratchet').elements()).toHaveLength(0);
		}
	);

	// The floor — without this, the assertions above would pass just as happily against a page that
	// renders no related-papers section at all.
	it('renders the section heading whenever a routable paper is present', async () => {
		mount([PAPER]);
		await expect.element(page.getByText('Related papers')).toBeVisible();
	});

	// ...and the section GATES on what will actually render, not on the raw array. Gating on the raw
	// array leaves the heading standing over an empty <ul> — DAR-56's empty-wrapper trap, and here a
	// heading promising links there are none of. The floor above is what makes this non-vacuous: one
	// asserts the heading appears for a good paper, the other that it doesn't for only-bad ones.
	it('renders no section at all when every related paper is unroutable', async () => {
		mount([
			{ ...PAPER, slug: '../admin' },
			{ ...PAPER, _id: 'paper.other', title: 'Another Paper', slug: 'a/b' }
		]);
		expect(page.getByText('Related papers').elements()).toHaveLength(0);
		expect(document.querySelectorAll('ul:empty')).toHaveLength(0);
	});

	// The mixed case: one good, one bad. The section survives with only the routable row — dropping
	// the whole section on a single bad slug would hide a good cross-reference.
	it('keeps the section, minus the unroutable rows', async () => {
		mount([PAPER, { ...PAPER, _id: 'paper.bad', title: 'Broken Link Paper', slug: '../login' }]);
		await expect.element(relatedLink()).toHaveAttribute('href', '/research/intelligence-ratchet');
		expect(page.getByText('Broken Link Paper').elements()).toHaveLength(0);
	});
});
