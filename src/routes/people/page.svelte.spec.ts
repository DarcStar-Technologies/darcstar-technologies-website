import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// See the note in [slug]/page.svelte.spec.ts — CosmicBackdrop reads theme custom properties and
// throws without the sheet, which fails the run.
import '../layout.css';
import type { PageData } from './$types';

// The grid's link into /people/[slug] is the ONLY way a visitor reaches a profile, so a route that
// renders every authored field is worth nothing if nothing points at it — "exists but renders
// nowhere" would simply become "renders but is reachable from nowhere" (DAR-122).
//
// It has to be asserted here rather than in page.svelte.e2e.ts: that suite runs without
// SANITY_VIEWER_TOKEN (DAR-96), so the live grid is empty and has no cards to link.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/people'), data: {}, params: {}, route: {} }
}));

const { default: PeoplePage } = await import('./+page.svelte');

type Person = PageData['people'][number];

const ADA: Person = {
	_id: 'person.ada',
	name: 'Ada Lovelace',
	slug: 'ada-lovelace',
	role: 'Chief Scientist',
	image: null,
	bio: 'Builds analytical engines.',
	socialLinks: [{ _key: 'sl1', label: 'GitHub', url: 'https://github.com/ada' }]
};

const mount = (people: Person[]) => render(PeoplePage, { data: { people } as PageData });

describe('/people', () => {
	it('links each teammate to their profile', async () => {
		mount([ADA]);
		await expect
			.element(page.getByRole('link', { name: /Ada Lovelace/ }))
			.toHaveAttribute('href', '/people/ada-lovelace');
	});

	// TypeGen types `slug` as non-null because the Studio marks it required, but that describes the
	// SCHEMA — an API write skips Studio validation. A slugless teammate keeps their card and loses
	// the link, rather than being dropped from the team page or linked to /people/null.
	it('keeps a slugless teammate on the page, without a link', async () => {
		mount([{ ...ADA, slug: null as unknown as string }]);
		await expect.element(page.getByText('Ada Lovelace')).toBeVisible();
		expect(page.getByRole('link', { name: /Ada Lovelace/ }).elements()).toHaveLength(0);
	});

	// Same outcome, different cause (DAR-148): the slug is present but names a page /people/[slug]
	// cannot serve. `../admin` resolves OUT of the section, so the truthiness check above would have
	// linked the team page straight at the login wall — and the JSON-LD `@id`, which asks the same
	// predicate, would have published it as this person's identity.
	it.each(['../admin', '..\\admin', '../../login', 'a/b'])(
		'keeps a teammate whose slug is %s on the page, without a link',
		async (slug) => {
			mount([{ ...ADA, slug }]);
			await expect.element(page.getByText('Ada Lovelace')).toBeVisible();
			expect(page.getByRole('link', { name: /Ada Lovelace/ }).elements()).toHaveLength(0);
		}
	);

	it('says so when there is no team to show', async () => {
		mount([]);
		await expect.element(page.getByText('Team details coming soon.')).toBeVisible();
	});
});
