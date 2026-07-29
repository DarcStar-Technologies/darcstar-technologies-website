import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// CosmicBackdrop paints from the theme's --color-*-500 and `addColorStop('')` THROWS, which vitest
// reports as an unhandled error and exits 1 — see /people/[slug]/page.svelte.spec.ts.
import '../layout.css';
import type { PageServerData } from './$types';

// DAR-148: the title is this card's one internal link, so an unroutable slug must cost the link and
// nothing else — everything the card carries about the paper (status, origin, venue, authors,
// abstract, topics, external links) is legitimate standalone content. page.svelte.e2e.ts cannot
// assert it: CI runs without SANITY_VIEWER_TOKEN (DAR-96), so the live index is empty there.
// Mutable so a test can put a filter in the URL — the page reads its filter state from `page.url`,
// not from `data`, so that is the only way in. `vi.hoisted` because `vi.mock` is hoisted above
// ordinary consts. Mutation is not reactive, which is fine: it is set before `render`, and each test
// restores it.
const { pageState } = vi.hoisted(() => ({
	pageState: {
		url: new URL('http://localhost/research'),
		data: {},
		params: {},
		route: {}
	} as { url: URL; data: object; params: object; route: object }
}));
vi.mock('$app/state', () => ({ page: pageState }));

const at = (search: string) => {
	pageState.url = new URL(`http://localhost/research${search}`);
};
afterEach(() => at(''));

const { default: ResearchPage } = await import('./+page.svelte');

type Paper = PageServerData['papers'][number];

const PAPER: Paper = {
	_id: 'paper.ratchet',
	title: 'The Intelligence Ratchet',
	slug: 'intelligence-ratchet',
	status: 'preprint',
	// Unset is the corpus's normal state — 17 of 18 papers declare no kind — so the shared fixture
	// carries none and the one test that needs a kind overrides it.
	contribution: null,
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

// What the Contribution select actually offers a visitor. Read off the DOM rather than from
// `contributionOptions` (which has its own unit test) so this asserts the wiring: the facet reaching
// the component, the labeller, and the "All kinds" empty option the snippet prepends.
const optionLabels = (container: HTMLElement) =>
	[...container.querySelectorAll('select[name="contribution"] option')].map((o) =>
		o.textContent?.trim()
	);

const mount = (papers: Paper[], contributions: string[] = []) =>
	render(ResearchPage, {
		data: {
			papers,
			total: papers.length,
			totalAll: papers.length,
			topics: [],
			contributions,
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

	// DAR-162 wiring, the same shape as the DAR-153 assertion above: PaperContribution has its own
	// spec, and this proves the list card actually mounts it. The list is the surface that needed it
	// most — PaperOrigin renders nothing for a first-party paper, so a DarcStar entry's commentary
	// never appears here and the pill is the only thing on this page that can say what kind of work
	// it is.
	//
	// Scoped to the CARD (`listitem`), not the page: once the facet offers this kind, the same string
	// is also an `<option>` in the filter bar, so an unscoped `getByText` matches two elements and
	// would pass on the select alone — asserting the control exists while the pill was missing.
	it('renders the contribution pill on a card that declares a kind', async () => {
		mount([{ ...PAPER, contribution: 'conceptual' }], ['conceptual']);
		await expect
			.element(page.getByRole('listitem').getByText('Conceptual framework'))
			.toBeVisible();
	});

	// The other 17 papers. An always-on pill would be worse than none: it would say every entry's kind
	// is known when only one is.
	//
	// The facet DOES offer `conceptual` here, which is production's actual state (one paper classified,
	// 17 not) and is what makes this test mean anything: the string is on the page, in the select, so a
	// card asserted to lack it is a claim about the card rather than about the corpus.
	it('renders no contribution pill for a paper that declares no kind', () => {
		const { container } = mount([PAPER], ['conceptual']);
		const card = container.querySelector('li');
		expect(card?.textContent).not.toContain('Conceptual framework');
	});

	// The facet is sourced from the taxonomy of kinds IN USE, so an index where nothing is classified
	// offers only "All kinds" — never four picks that each return zero.
	it('offers no contribution options until some paper declares a kind', () => {
		const { container } = mount([PAPER]);
		expect(optionLabels(container)).toEqual(['All kinds']);
	});

	it('offers exactly the kinds in use', () => {
		const { container } = mount([{ ...PAPER, contribution: 'conceptual' }], ['conceptual']);
		expect(optionLabels(container)).toEqual(['All kinds', 'Conceptual framework']);
	});

	// The one case where "only offer what matches something" gives the wrong answer. A visitor on
	// `?contribution=conceptual` when no paper declares it must still see a labelled, switchable
	// control: without folding the active kind in, the snippet falls through to its synthetic-option
	// branch and renders the raw token `conceptual` among prose labels.
	//
	// The facet here is `engineering` and the active kind sorts BEFORE it, which is what makes this
	// also an ordering assertion — appended, the active kind would come last.
	it('labels the active kind even when no paper declares it', () => {
		at('?contribution=conceptual');
		const { container } = mount([PAPER], ['engineering']);
		expect(optionLabels(container)).toEqual([
			'All kinds',
			'Conceptual framework',
			'Engineering report'
		]);
	});

	// Junk never becomes an option — the parser discards it, so the control reads "All kinds" rather
	// than offering `banana` back to the visitor as though it were a kind.
	it('offers no option for a junk contribution param', () => {
		at('?contribution=banana');
		const { container } = mount([{ ...PAPER, contribution: 'conceptual' }], ['conceptual']);
		expect(optionLabels(container)).toEqual(['All kinds', 'Conceptual framework']);
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
