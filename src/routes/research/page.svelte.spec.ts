import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// CosmicBackdrop paints from the theme's --color-*-500 and `addColorStop('')` THROWS, which vitest
// reports as an unhandled error and exits 1 — see /people/[slug]/page.svelte.spec.ts.
import '../layout.css';
import type { PageServerData } from './$types';

// DAR-148: the title is this card's one internal link, so an unroutable slug must cost the link and
// nothing else — everything the card carries about the paper (status, origin, venue, authors,
// abstract, topics, external links) is legitimate standalone content. page.svelte.e2e.ts cannot
// assert it: CI runs without SANITY_VIEWER_TOKEN (DAR-96), so the live index is empty there.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/research'), data: {}, params: {}, route: {} }
}));

const { default: ResearchPage } = await import('./+page.svelte');

type Paper = PageServerData['papers'][number];

const PAPER: Paper = {
	_id: 'paper.ratchet',
	title: 'The Intelligence Ratchet',
	slug: 'intelligence-ratchet',
	status: 'preprint',
	darcstarAuthored: true,
	hasCommentary: false,
	venue: 'arXiv',
	publishedDate: '2026-02-04',
	url: null,
	doi: null,
	arxivId: null,
	codeUrl: null,
	abstract: 'A short abstract.',
	authors: [],
	topics: []
};

const mount = (papers: Paper[]) =>
	render(ResearchPage, {
		data: {
			papers,
			total: papers.length,
			totalAll: papers.length,
			topics: [],
			teamAuthors: [],
			authorLabel: null,
			page: 1,
			pageCount: 1,
			from: 1,
			to: papers.length
		} as PageServerData
	});

describe('/research', () => {
	// DAR-153 wiring. PaperVenueDate owns the separator and has its own spec; this proves the index
	// actually renders it, which is the half that was wrong in production — all 18 cards served
	// `Zenodo·February 4, 2026`. Asserted on the card's whole normalised text rather than on a
	// selector, because PaperStatus's pill also carries `text-xs text-muted` and would be matched
	// first: the claim is about what a reader sees, not about which element carries it.
	it('renders the venue and date with a separator between them', () => {
		const { container } = mount([PAPER]);
		expect(container.textContent?.replace(/\s+/g, ' ')).toContain('arXiv · February 4, 2026');
	});

	it('links a paper title to its page', async () => {
		mount([PAPER]);
		await expect
			.element(page.getByRole('link', { name: 'The Intelligence Ratchet' }))
			.toHaveAttribute('href', '/research/intelligence-ratchet');
	});

	it.each(['../login', '..\\admin', '../../admin', 'a/b', ''])(
		'renders the title of a paper slugged "%s" as plain text',
		async (slug) => {
			mount([{ ...PAPER, slug }]);
			// The card stays, with everything that isn't the link.
			await expect.element(page.getByText('The Intelligence Ratchet')).toBeVisible();
			await expect.element(page.getByText('A short abstract.')).toBeVisible();
			expect(page.getByRole('link', { name: 'The Intelligence Ratchet' }).elements()).toHaveLength(
				0
			);
		}
	);
});
