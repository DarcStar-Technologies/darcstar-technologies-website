import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// CosmicBackdrop paints from the theme's --color-*-500 and `addColorStop('')` THROWS without the
// sheet — see the fuller note in /people/[slug]/page.svelte.spec.ts.
import '../../layout.css';
import type { PageServerData } from './$types';
import type { RenderedBlockContent } from '$lib/sanity/block-content';

// This route had no spec at all, and it is the instance DAR-153's own scope table MISSED: that table
// was written by checking surfaces I thought of, so the detail page — carrying markup byte-identical
// to the index card — went unlisted while serving `Zenodo·February 4, 2026` in production just as
// visibly. Enumerating the pattern in SOURCE is what found it. Nothing in CI can see the rendering
// either way: e2e runs without SANITY_VIEWER_TOKEN (DAR-96), so this route 404s there.
vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/research/intelligence-ratchet'),
		data: {},
		params: { slug: 'intelligence-ratchet' },
		route: {}
	}
}));

const { default: PaperPage } = await import('./+page.svelte');

type Paper = PageServerData['paper'];

const PAPER: Paper = {
	_id: 'paper.ratchet',
	_updatedAt: '2026-02-04T00:00:00Z',
	title: 'The Intelligence Ratchet',
	slug: 'intelligence-ratchet',
	status: 'preprint',
	contribution: null,
	darcstarAuthored: true,
	abstract: 'A short abstract.',
	commentary: null,
	venue: 'Zenodo',
	publishedDate: '2026-02-04',
	url: null,
	doi: null,
	arxivId: null,
	codeUrl: null,
	pdfUrl: null,
	authors: null,
	topics: null,
	categories: null,
	seo: null
};

const mount = (paper: Paper) => render(PaperPage, { data: { paper } as PageServerData });

const shown = (container: HTMLElement) => container.textContent?.replace(/\s+/g, ' ') ?? '';

// Enough commentary to make the section exist — the caveat below is a LINK to it, so its presence is
// the condition, not its contents. Already typeset, as the type demands (`renderMathIn` is
// server-only), matching PortableBody's own spec.
const COMMENTARY = [
	{
		_type: 'block',
		_key: 'c1',
		style: 'normal',
		markDefs: [],
		children: [{ _type: 'span', _key: 's1', text: 'Our assessment.', marks: [] }]
	}
] as unknown as RenderedBlockContent;

const CAVEAT = 'a framework we are proposing, not a demonstrated result';

describe('/research/[slug]', () => {
	it('renders the venue and date with a separator between them', () => {
		const { container } = mount(PAPER);
		expect(shown(container)).toContain('Zenodo · February 4, 2026');
	});

	// The floor: without it the assertion above could pass against a page that renders neither value,
	// since `toContain` on absent text and on correct text differ only by what is there to find.
	it('renders the venue and the date at all', () => {
		const { container } = mount(PAPER);
		expect(shown(container)).toContain('Zenodo');
		expect(shown(container)).toContain('February 4, 2026');
	});

	// The `·` sweep is safe only because this mounts the PAGE, not the layout: the footer carries two
	// separators of its own and would make it fail for a reason that has nothing to do with the rail.
	// Stated because it is an assumption about what is absent, which no reader can see from the code.
	it('renders a paper with no venue as just its date', () => {
		const { container } = mount({ ...PAPER, venue: null });
		expect(shown(container)).toContain('February 4, 2026');
		expect(shown(container)).not.toContain('·');
	});

	// DAR-162. The pill is the cheap half; the caveat is the one with a rule behind it.
	it('renders the contribution pill in the meta rail', () => {
		const { container } = mount({ ...PAPER, contribution: 'conceptual' });
		expect(shown(container)).toContain('Conceptual framework');
	});

	it('renders no pill for a paper that declares no kind', () => {
		const { container } = mount(PAPER);
		expect(shown(container)).not.toContain('Conceptual framework');
	});

	// The caveat exists because this page puts the abstract card ABOVE the commentary card, so a
	// reader meets the paper's strongest claims before the section qualifying them. Asserting the
	// ORDER, not just the presence: placed after the abstract it would be decoration.
	it('places the conceptual caveat above the abstract', () => {
		const { container } = mount({ ...PAPER, contribution: 'conceptual', commentary: COMMENTARY });
		const text = shown(container);
		expect(text).toContain(CAVEAT);
		expect(text.indexOf(CAVEAT)).toBeLessThan(text.indexOf('A short abstract.'));
	});

	it('points the caveat at the commentary section it is about', () => {
		const { container } = mount({ ...PAPER, contribution: 'conceptual', commentary: COMMENTARY });
		expect(container.querySelector('a[href="#commentary"]')).not.toBeNull();
		// The target has to exist or the link scrolls nowhere — the two halves are one claim.
		expect(container.querySelector('#commentary')).not.toBeNull();
	});

	// Only the call-to-action clause is the anchor, not the whole card. The statement was inside the
	// link at first, which gave a screen reader a two-sentence link name and left the card with no
	// visible affordance beyond a hover border — invisible on touch. Asserted because the tidier-looking
	// version is to wrap the lot in one `<a>`, and nothing else here would notice.
	it('links only the call to action, not the statement', () => {
		const { container } = mount({ ...PAPER, contribution: 'conceptual', commentary: COMMENTARY });
		const link = container.querySelector('a[href="#commentary"]');
		expect(link?.textContent?.trim()).toBe(
			'Read our assessment of what it does and does not establish'
		);
		expect(link?.textContent).not.toContain(CAVEAT);
	});

	// A caveat with nothing to link to is worse than none: it promises an assessment the page does not
	// carry. The gate is what makes the copy honest, so it is asserted rather than assumed.
	it('renders no caveat for a conceptual paper with no commentary', () => {
		const { container } = mount({ ...PAPER, contribution: 'conceptual' });
		expect(shown(container)).not.toContain(CAVEAT);
	});

	// The other three kinds are claims a paper can back — a formal result, a measured study, a shipped
	// system — so "not a demonstrated result" would be false in front of them.
	it.each(['formal', 'empirical', 'engineering'] as const)(
		'renders no caveat for a %s paper with commentary',
		(contribution) => {
			const { container } = mount({ ...PAPER, contribution, commentary: COMMENTARY });
			expect(shown(container)).not.toContain(CAVEAT);
		}
	);
});
