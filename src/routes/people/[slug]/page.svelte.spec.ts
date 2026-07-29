import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// The root layout's stylesheet, which a page rendered in isolation would otherwise not have. Not
// cosmetic: `CosmicBackdrop` paints its glows from the theme's `--color-*-500` custom properties, and
// without them `addColorStop('')` throws — an unhandled error that fails the run (vitest is right to:
// an exception mid-render can leave assertions passing against a half-built page). Loading the real
// sheet also makes `toBeVisible()` mean what it says.
import '../../layout.css';
import type { PageData } from './$types';

// DAR-122's rendering acceptance. The whole ticket is "these fields exist in the CMS and the site
// drops them", so the thing worth proving is that each one reaches the page — and this is the only
// place it CAN be proven automatically: CI's e2e runs without SANITY_VIEWER_TOKEN (DAR-96), so
// /people is empty there and a person detail page 404s. Here a published document is just a prop.
//
// It runs in real chromium (the `client` vitest project), which is what makes "visible" mean visible
// rather than merely present in the DOM.
//
// `Seo.svelte` reads `$app/state`, which only exists inside a running Kit client, and this page reads
// it too (the JSON-LD's page URL). Stub the one object both touch.
vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/people/ada-lovelace'),
		data: {},
		params: { slug: 'ada-lovelace' },
		route: {}
	}
}));

const { default: PersonPage } = await import('./+page.svelte');

// `PageData` also carries the root layout's half (a Better Auth `user` + `isStaff`), which this page
// reads none of — pick only this route's own load return, so the fixture still breaks if a projected
// field changes shape but doesn't have to fake a session.
type PageFixture = Pick<PageData, 'person'>;
type Person = PageFixture['person'];

// Shaped like the real `seed.person.michael-harris` document: every optional background field filled,
// because the point is that every one of them renders.
const PERSON: Person = {
	_id: 'person.ada',
	_updatedAt: '2026-07-28T00:00:00Z',
	name: 'Ada Lovelace',
	slug: 'ada-lovelace',
	role: 'Chief Scientist',
	image: null,
	bio: 'Builds analytical engines.',
	fullBio: [
		{
			_type: 'block',
			_key: 'b1',
			style: 'normal',
			markDefs: [],
			children: [{ _type: 'span', _key: 's1', text: 'The authored biography, in full.', marks: [] }]
		}
	],
	focusAreas: ['Distributed systems', 'Applied AI'],
	responsibilities: ['Sets the verification agenda'],
	experience: [
		{
			_key: 'exp1',
			title: 'Principal Systems Architect',
			organization: 'Ledger Rocket',
			startYear: 2025,
			endYear: null,
			summary: 'Systems architecture on a contract engagement.',
			url: null
		},
		{
			_key: 'exp2',
			title: 'Founder & CEO',
			organization: 'DarcStar Solutions',
			startYear: 2015,
			endYear: 2015,
			summary: null,
			url: 'https://example.com/darcstar-solutions'
		}
	],
	education: [
		{
			_key: 'edu1',
			qualification: 'B.S. Computer Science',
			institution: 'Northern Illinois University',
			year: 2005
		}
	],
	socialLinks: [{ label: 'GitHub', url: 'https://github.com/ada' }]
};

const mount = (over: Partial<Person> = {}) =>
	render(PersonPage, { data: { person: { ...PERSON, ...over } } as PageData });

describe('/people/[slug]', () => {
	// The regression this ticket IS: every one of these was authored in the Studio and rendered
	// nowhere. If a section is dropped from the page, exactly this test says so.
	it('renders the authored background the team grid never showed', async () => {
		mount();

		await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Ada Lovelace');
		await expect.element(page.getByText('Chief Scientist')).toBeVisible();
		await expect.element(page.getByText('The authored biography, in full.')).toBeVisible();

		await expect.element(page.getByText('Focus areas')).toBeVisible();
		await expect.element(page.getByText('Distributed systems')).toBeVisible();

		await expect.element(page.getByText('Responsibilities')).toBeVisible();
		await expect.element(page.getByText('Sets the verification agenda')).toBeVisible();

		await expect.element(page.getByText('Experience')).toBeVisible();
		await expect.element(page.getByText('Principal Systems Architect')).toBeVisible();
		await expect
			.element(page.getByText('Systems architecture on a contract engagement.'))
			.toBeVisible();

		await expect.element(page.getByText('Education')).toBeVisible();
		await expect.element(page.getByText('B.S. Computer Science')).toBeVisible();
		await expect.element(page.getByText('Northern Illinois University')).toBeVisible();
	});

	// An open-ended position is the common case for a current role, and rendering "2025–" (or worse,
	// "2025–null") is the shape a naive interpolation produces. A same-year position collapses: three
	// of the nine positions on the live document start and end in one year, and "2015–2015" reads as a
	// rendering bug rather than as a role held for part of a year.
	it('closes an ongoing position with Present and collapses a same-year one', async () => {
		mount();
		await expect.element(page.getByText('2025–Present')).toBeVisible();
		expect(page.getByText('2015–2015').elements()).toHaveLength(0);
		await expect.element(page.getByText('2015', { exact: false })).toBeVisible();
	});

	it('renders a genuine multi-year span as a range', async () => {
		mount({ experience: [{ ...PERSON.experience![0], startYear: 2012, endYear: 2015 }] });
		await expect.element(page.getByText('2012–2015')).toBeVisible();
	});

	// Svelte trims the LEADING whitespace of an {#if} block, so the obvious markup renders
	// "Ledger Rocket· 2025–Present" — found by looking at the page, not by any assertion, which is
	// why it now has one. PageHero documents the same trap for its emphasis word.
	it('keeps a space either side of the meta separator', async () => {
		mount();
		for (const line of ['Ledger Rocket · 2025–Present', 'Northern Illinois University · 2005']) {
			await expect.element(page.getByText(line)).toBeVisible();
		}
	});

	it('links an organization only when the CMS supplied a usable URL', async () => {
		mount();
		await expect
			.element(page.getByRole('link', { name: 'DarcStar Solutions' }))
			.toHaveAttribute('href', 'https://example.com/darcstar-solutions');
		// The position with no `url` renders its organization as text, not a dead link.
		expect(page.getByRole('link', { name: 'Ledger Rocket' }).elements()).toHaveLength(0);
	});

	// The Studio's url field is a UI affordance an API write skips (DAR-70), so an unusable value must
	// degrade to plain text rather than shipping `href="javascript:…"` into the page.
	it('refuses a non-http organization URL rather than rendering it as a link', async () => {
		mount({
			experience: [{ ...PERSON.experience![1], url: 'javascript:alert(1)' }]
		});
		await expect.element(page.getByText('DarcStar Solutions')).toBeVisible();
		expect(page.getByRole('link', { name: 'DarcStar Solutions' }).elements()).toHaveLength(0);
	});

	// A profile whose optional fields are all empty must not render a run of empty headings — the
	// Studio has five of them and only one person fills most.
	it('renders no empty sections for a person with only a name', async () => {
		mount({
			bio: null,
			fullBio: null,
			focusAreas: null,
			responsibilities: null,
			experience: null,
			education: null,
			socialLinks: null
		});
		await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Ada Lovelace');
		for (const heading of ['Focus areas', 'Responsibilities', 'Experience', 'Education']) {
			expect(
				page.getByText(heading).elements(),
				`${heading} should not render with nothing under it`
			).toHaveLength(0);
		}
	});

	it('offers a way back to the team', async () => {
		mount();
		await expect
			.element(page.getByRole('link', { name: '← All people' }))
			.toHaveAttribute('href', '/people');
	});
});
