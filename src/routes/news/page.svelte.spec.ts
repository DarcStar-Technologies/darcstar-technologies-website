import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// CosmicBackdrop paints from the theme's --color-*-500 and `addColorStop('')` THROWS, which vitest
// reports as an unhandled error and exits 1 — see [slug]/page.svelte.spec.ts under /people.
import '../layout.css';
import type { PageServerData } from './$types';

// The whole card is the link here, so DAR-148's guard has more to do on this page than anywhere
// else: an unroutable slug has to take the anchor, the hover affordance AND the "Read article" call
// to action with it. A card that still says "Read article" and goes nowhere is a worse lie than the
// link was, and no other spec renders this markup — page.svelte.e2e.ts runs without
// SANITY_VIEWER_TOKEN (DAR-96), so the live feed is empty there and has no card to assert on.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/news'), data: {}, params: {}, route: {} }
}));

const { default: NewsPage } = await import('./+page.svelte');

type Post = PageServerData['posts'][number];

const POST: Post = {
	_id: 'post.hello',
	title: 'Hello from DarcStar',
	slug: 'hello-from-darcstar',
	excerpt: 'A first note.',
	publishedAt: '2026-07-22',
	coverImage: null,
	authors: []
};

const mount = (posts: Post[]) =>
	render(NewsPage, {
		data: { posts, total: posts.length, page: 1, pageCount: 1 } as PageServerData
	});

const card = () => page.getByText('Hello from DarcStar');

describe('/news', () => {
	it('makes the whole card a link to the post', async () => {
		mount([POST]);
		await expect
			.element(page.getByRole('link', { name: /Hello from DarcStar/ }))
			.toHaveAttribute('href', '/news/hello-from-darcstar');
		await expect.element(page.getByText('Read article')).toBeVisible();
	});

	// `../admin` resolves OUT of the section through `new URL` — the card would have linked the feed
	// at the login wall. `a/b` is the other half of the guard: routable-looking, but /news/[slug]
	// matches a single segment, so it is a 404 dressed as a link.
	it.each(['../admin', '..\\admin', '../../login', 'a/b', ''])(
		'renders a post whose slug is "%s" as an inert card',
		async (slug) => {
			mount([{ ...POST, slug }]);
			// The post keeps its card — a broken slug is debuggable, a vanished post is not.
			await expect.element(card()).toBeVisible();
			expect(page.getByRole('link', { name: /Hello from DarcStar/ }).elements()).toHaveLength(0);
			// ...and stops promising a destination it cannot reach.
			expect(page.getByText('Read article').elements()).toHaveLength(0);
		}
	);

	// The hover treatment is the card's other "this goes somewhere" signal, and it rides on `.group`,
	// which also drives the title's colour change. Asserted through the CLASS rather than a rendered
	// colour because the states it gates are hover/focus ones no static render can enter. One mount
	// per test: two in one would leave both renders in the document and let a querySelector answer
	// from the wrong one.
	it('carries the hover affordance on a linked card', () => {
		const { container } = mount([POST]);
		const linked = container.querySelector('li > a');
		expect(linked?.className).toContain('group');
	});

	it('drops the hover affordance along with the link', () => {
		const { container } = mount([{ ...POST, slug: '../admin' }]);
		const inert = container.querySelector('li > div.glass-card');
		expect(inert, 'the card should degrade to a plain element, not disappear').not.toBeNull();
		expect(inert?.className).not.toContain('group');
	});
});
