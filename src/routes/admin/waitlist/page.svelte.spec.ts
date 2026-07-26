import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { PageData } from './$types';

// DAR-65's rendering acceptance: the triage view rendered from seeded fixture data. It lives here
// rather than in the e2e suite because that suite is hermetic — no session cookie and no reachable
// DB — so it can only ever assert the /admin guard's redirect (page.svelte.e2e.ts does exactly
// that). Here a "seeded row" is just a prop, and the whole page renders: badges, label resolution,
// the tri-state outreach column, the filter chips and the detail disclosure.
//
// `Seo.svelte` reads `$app/state`, which only exists inside a running Kit client. Nothing this spec
// asserts lives in <svelte:head>, so stub the one object Seo touches.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/admin/waitlist'), data: {}, params: {}, route: {} }
}));

const { default: AdminWaitlistPage } = await import('./+page.svelte');

type Signup = PageData['signups'][number];
// `PageData` also carries the /admin layout's half (a Better Auth `user` + `isAdmin`), which this
// page reads none of. Pick only this route's own load return, so the fixture still breaks if a
// column's type changes but doesn't have to fake a session.
type PageFixture = Pick<PageData, 'signups' | 'counts' | 'filter' | 'total' | 'limit'>;

const ROW: Signup = {
	id: 'row-1',
	email: 'lead@example.com',
	name: 'Ada Lovelace',
	company: 'Analytical Engines',
	role: 'engineering-leader',
	companySize: null,
	interest: null,
	hearAbout: null,
	phone: '+1 555 0100',
	countryRegion: 'north-america',
	consentUpdates: true,
	primaryApplication: 'robotics-autonomous-systems',
	evaluationTimeline: 'within-3-months',
	currentApproach: 'internal-system',
	economicImpact: 'over-1m',
	budgetRange: '25k-100k',
	adoptionEvidence: ['evaluation-pilot', 'formal-proof-artifacts'],
	pilotInterest: 'yes-within-3-months',
	deploymentScale: 'Two inspection cells',
	contactPermission: true,
	contactMethod: 'phone-video',
	researchPreferences: null,
	qualificationStep: 4,
	createdAt: new Date('2026-07-01T12:00:00Z'),
	updatedAt: new Date('2026-07-02T12:00:00Z'),
	leadClass: 'priority-a'
};

const RESEARCHER: Signup = {
	...ROW,
	id: 'row-2',
	email: 'reader@example.com',
	name: null,
	company: null,
	role: 'researcher',
	primaryApplication: 'research-education',
	pilotInterest: null,
	contactPermission: null,
	deploymentScale: null,
	researchPreferences: ['technical-reports'],
	leadClass: 'research'
};

const data = (over: Partial<PageFixture> = {}): PageFixture => ({
	signups: [ROW, RESEARCHER],
	counts: { 'priority-a': 1, 'priority-b': 0, 'priority-c': 0, research: 1, investor: 0 },
	filter: null,
	total: 2,
	limit: 200,
	...over
});

const mount = (over?: Partial<PageFixture>) =>
	render(AdminWaitlistPage, { data: data(over) as PageData, form: null });

describe('/admin/waitlist', () => {
	it('renders a badge, the row summary and the qualification detail for each signup', async () => {
		mount();

		await expect.element(page.getByText('Priority A', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Research / community', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'lead@example.com' })).toBeVisible();
		// The label sets resolve rather than leaking a raw slug.
		await expect
			.element(page.getByText('Engineering or technical leader', { exact: true }))
			.toBeVisible();
		// The detail is in the DOM even while its <details> is closed — no JS needed to reveal it.
		await expect.element(page.getByText('Two inspection cells')).toBeInTheDocument();
		await expect.element(page.getByText('Robotics & autonomous systems')).toBeInTheDocument();
	});

	it('renders contact permission as the tri-state it is', async () => {
		mount();
		await expect.element(page.getByText('Authorized', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Not asked', { exact: true })).toBeVisible();
	});

	it('marks exactly one filter chip current and uses the band-specific empty state', async () => {
		const { container } = mount({ filter: 'priority-a', signups: [] });

		// One, not two: the layout nav already owns the page's aria-current="page".
		const current = container.querySelectorAll('[aria-current]');
		expect(current).toHaveLength(1);
		expect(current[0].textContent).toContain('Priority A');
		await expect.element(page.getByText('No signups in this band.')).toBeVisible();
	});

	// A bare `?/delete` resolves to /admin/waitlist?/delete and drops `class=`, bouncing the operator
	// out of the band they were working in.
	it('carries the active filter into every delete action', () => {
		const { container } = mount({ filter: 'priority-a' });
		const actions = [...container.querySelectorAll('form[method="post"]')].map((f) =>
			f.getAttribute('action')
		);
		expect(actions).toHaveLength(2);
		expect(new Set(actions)).toEqual(new Set(['?/delete&class=priority-a']));
	});

	it('shows the internal-only and unverified-claim caveats', async () => {
		mount();
		await expect.element(page.getByText(/internal triage signal/)).toBeVisible();
		await expect.element(page.getByText(/unverified claims/)).toBeVisible();
	});
});
