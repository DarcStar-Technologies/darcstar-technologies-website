import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// CosmicBackdrop paints from the theme's --color-*-500 and `addColorStop('')` THROWS without the
// sheet — see the fuller note in /people/[slug]/page.svelte.spec.ts.
import '../../layout.css';
import type { PageServerData } from './$types';

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

	it('renders a paper with no venue as just its date', () => {
		const { container } = mount({ ...PAPER, venue: null });
		expect(shown(container)).toContain('February 4, 2026');
		expect(shown(container)).not.toContain('·');
	});
});
