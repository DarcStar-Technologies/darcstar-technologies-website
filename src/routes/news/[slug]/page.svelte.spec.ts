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
});
