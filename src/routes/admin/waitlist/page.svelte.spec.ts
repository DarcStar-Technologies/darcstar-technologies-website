import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ActionData, PageData } from './$types';

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
type PageFixture = Pick<
	PageData,
	'signups' | 'counts' | 'filter' | 'total' | 'limit' | 'funnel' | 'conversion'
>;

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
	invitedAt: null,
	invitedBy: null,
	activatedAt: null,
	createdAt: new Date('2026-07-01T12:00:00Z'),
	updatedAt: new Date('2026-07-02T12:00:00Z'),
	leadClass: 'priority-a',
	inviteState: 'not-invited'
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
	leadClass: 'research',
	// Already invited (DAR-67) — so one row in the default fixture exercises the resend affordance.
	invitedAt: new Date('2026-07-03T09:00:00Z'),
	invitedBy: 'staff-1',
	activatedAt: null,
	inviteState: 'invited'
};

// The funnel readout's fixture (DAR-66). Deliberately a shrinking series with 200 views and 50
// signups, so the rendered conversion is an unambiguous 25%.
const FUNNEL: PageFixture['funnel'] = {
	waitlist_viewed: 200,
	waitlist_signup_completed: 50,
	qualification_started: 40,
	use_case_completed: 30,
	commercial_context_completed: 12,
	pilot_interest_selected: 8,
	qualification_completed: 25,
	evaluation_conversation_requested: 3
};

const data = (over: Partial<PageFixture> = {}): PageFixture => ({
	signups: [ROW, RESEARCHER],
	counts: { 'priority-a': 1, 'priority-b': 0, 'priority-c': 0, research: 1, investor: 0 },
	filter: null,
	total: 2,
	limit: 200,
	funnel: FUNNEL,
	conversion: 0.25,
	...over
});

const mount = (over?: Partial<PageFixture>, form: ActionData = null) =>
	render(AdminWaitlistPage, { data: data(over) as PageData, form });

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

	// The counts are windowed too, so "Priority A (0)" means none in the most recent slice — not
	// none on the list. An empty band is exactly where that distinction matters most, and it's the
	// one view with no table to hang the note off.
	it('discloses the read cap even when a filter leaves nothing to show', async () => {
		mount({ filter: 'priority-b', signups: [], total: 200, limit: 200 });

		await expect.element(page.getByText('No signups in this band.')).toBeVisible();
		await expect.element(page.getByText('Showing the 200 most recent.')).toBeVisible();
	});

	// `mode: 'json'` columns are typed by assertion, not validation. One row holding
	// valid-but-not-array JSON must not take the whole triage page down.
	it('survives a multi-select column that is not an array', async () => {
		mount({
			signups: [{ ...ROW, adoptionEvidence: 'corrupted' as unknown as string[] }]
		});
		await expect.element(page.getByText('Priority A', { exact: true })).toBeVisible();
	});

	// A bare `?/delete` resolves to /admin/waitlist?/delete and drops `class=`, bouncing the operator
	// out of the band they were working in.
	it('carries the active filter into every delete action', () => {
		const { container } = mount({ filter: 'priority-a' });
		// Filtered to the delete forms — each row also carries an invite form (DAR-67), covered by its
		// own test below.
		const actions = [...container.querySelectorAll('form[method="post"]')]
			.map((f) => f.getAttribute('action'))
			.filter((a) => a?.startsWith('?/delete'));
		expect(actions).toHaveLength(2);
		expect(new Set(actions)).toEqual(new Set(['?/delete&class=priority-a']));
	});

	// DAR-66's readout. It renders every stage including the ones at zero — a stage nobody reached is
	// information, and a missing row would read as a broken counter.
	it('renders the funnel counts and the primary conversion rate', async () => {
		mount();

		await expect.element(page.getByText('Viewed the page')).toBeVisible();
		await expect.element(page.getByText('200', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Requested a conversation')).toBeVisible();
		await expect.element(page.getByText('Signup conversion')).toBeVisible();
		await expect.element(page.getByText('25%', { exact: true })).toBeVisible();
	});

	it('renders every funnel stage, including one nobody has reached', async () => {
		const { container } = mount({
			funnel: { ...FUNNEL, evaluation_conversation_requested: 0 },
			conversion: 0.25
		});

		// Scoped to the readout — each signup's qualification detail is a <dl> of its own.
		const stages = container.querySelectorAll(
			'section[aria-labelledby="waitlist-funnel-heading"] dl dt'
		);
		expect(stages).toHaveLength(8);
		await expect.element(page.getByText('0', { exact: true })).toBeVisible();
	});

	// No views means no denominator, and a rendered "0%" would say "nobody converts" rather than
	// "nothing measured". The server sends null; this is the view half of that contract.
	it('shows a dash rather than a rate when nothing has been viewed', async () => {
		const { container } = mount({
			funnel: { ...FUNNEL, waitlist_viewed: 0, waitlist_signup_completed: 0 },
			conversion: null
		});

		await expect.element(page.getByText('Signup conversion')).toBeVisible();
		// Scoped to the readout — asserting against the whole body would break the day any unrelated
		// copy on this page happens to contain a percent sign.
		const funnel = container.querySelector('section[aria-labelledby="waitlist-funnel-heading"]');
		expect(funnel?.textContent).not.toContain('%');
	});

	// A deploy that lands before its migration has no events table at all. The readout says so and the
	// LEADS STAY ON SCREEN — an analytics aggregate must not take the triage list down with it.
	it('degrades to a note when the readout is unavailable, keeping the signups', async () => {
		mount({ funnel: null, conversion: null });

		await expect.element(page.getByText('Funnel counts are unavailable right now.')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'lead@example.com' })).toBeVisible();
		await expect.element(page.getByText('Priority A', { exact: true })).toBeVisible();
	});

	// The readout sits on the same page as the leads, so it must stay a count of anonymous flows —
	// never a per-person breakdown, and never anything a row could be joined back to.
	it('keeps the readout free of any signup identity', async () => {
		const { container } = mount();

		const funnel = container.querySelector('section[aria-labelledby="waitlist-funnel-heading"]');
		expect(funnel?.textContent).not.toContain('lead@example.com');
		expect(funnel?.textContent).toContain('Directional only');
	});

	it('shows the internal-only and unverified-claim caveats', async () => {
		mount();
		await expect.element(page.getByText(/internal triage signal/)).toBeVisible();
		await expect.element(page.getByText(/unverified claims/)).toBeVisible();
	});
});

// DAR-67's invite-only onboarding. The state is decided server-side (`waitlistInviteState`, unit-tested
// in waitlist-invite.spec.ts); these cover what the operator actually sees and clicks.
describe('/admin/waitlist invitations', () => {
	it('renders each row in its own invite state', async () => {
		mount();
		// ROW has never been invited; RESEARCHER has. The detail-row labels are deliberately worded as
		// events ("Invitation sent", "Password set") rather than states, so these badge texts are unique
		// on the page and an exact match means the badge, not a <dt>.
		await expect.element(page.getByText('Not invited', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Invited', { exact: true })).toBeVisible();
	});

	it('shows the activated badge once the invitee has set a password', async () => {
		mount({
			signups: [
				{
					...ROW,
					invitedAt: new Date('2026-07-03T09:00:00Z'),
					invitedBy: 'staff-1',
					activatedAt: new Date('2026-07-04T09:00:00Z'),
					inviteState: 'activated'
				}
			]
		});
		await expect.element(page.getByText('Activated', { exact: true })).toBeVisible();
	});

	// The label is the only thing telling an operator whether they are about to send a first invitation
	// or a duplicate, so it has to track the row rather than the page.
	it('offers Invite for a fresh row and Resend for one already invited', async () => {
		mount();
		await expect.element(page.getByText('Invite', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Resend', { exact: true })).toBeVisible();
	});

	// A bare `?/invite` resolves to /admin/waitlist?/invite and drops `class=`, bouncing the operator out
	// of the band they were working in — the same trap the delete action already guards against.
	it('carries the active filter into every invite action', () => {
		const { container } = mount({ filter: 'priority-a' });
		const actions = [...container.querySelectorAll('form[method="post"]')]
			.map((f) => f.getAttribute('action'))
			.filter((a) => a?.startsWith('?/invite'));
		expect(actions).toHaveLength(2);
		expect(new Set(actions)).toEqual(new Set(['?/invite&class=priority-a']));
	});

	// Both outcome banners live at the top of the page: a no-JS submit re-renders the whole table, and
	// a status message buried in row 137 is not a confirmation.
	it('confirms a sent invitation, naming the address', async () => {
		mount(undefined, { invite: { ok: true, email: 'lead@example.com', created: true } });
		await expect.element(page.getByText('Invitation sent to lead@example.com.')).toBeVisible();
	});

	// The one failure with its own message: it needs a different action from the operator (go to the
	// roster), not a retry.
	it('explains a refusal to invite an address that already belongs to staff', async () => {
		mount(undefined, { invite: { error: 'staff_account' } });
		await expect.element(page.getByText(/already belongs to a staff account/)).toBeVisible();
	});

	// The account exists but nothing was mailed — so the row stays un-invited and retrying is right.
	it('distinguishes a send failure from a generic one', async () => {
		mount(undefined, { invite: { error: 'email_failed' } });
		await expect.element(page.getByText(/invitation email didn't send/)).toBeVisible();
	});

	it('falls back to the generic message for any other failure', async () => {
		mount(undefined, { invite: { error: 'create_failed' } });
		await expect.element(page.getByText(/Couldn't send that invitation/)).toBeVisible();
	});

	// A delete failure and an invite failure both carry an `error` key; only the namespace tells them
	// apart, so a delete error must not surface as an invite error or vice versa.
	it('keeps the delete error and the invite error apart', async () => {
		const { container } = mount(undefined, { error: 'forbidden' });
		expect(container.textContent).not.toContain("Couldn't send that invitation");
	});
});
