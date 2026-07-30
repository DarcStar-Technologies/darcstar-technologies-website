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

type Lead = PageData['leads'][number];
type Submission = Lead['submissions'][number];
// `PageData` also carries the /admin layout's half — a Better Auth `user`, which this page reads
// nothing of, and `isAdmin`, which since DAR-191 gates the lift control. So the pick takes this
// route's own load return plus that one flag: the fixture still breaks if a column's type changes,
// and still doesn't have to fake a session.
type PageFixture = Pick<
	PageData,
	| 'isAdmin'
	| 'leads'
	| 'counts'
	| 'filter'
	| 'total'
	| 'submissionTotal'
	| 'reviewTotal'
	| 'limit'
	| 'funnel'
	| 'conversion'
>;

const SUBMISSION: Submission = {
	id: 'sub-1',
	leadId: 'lead-1',
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
	consentUpdatesAt: new Date('2026-07-01T12:00:00Z'),
	primaryApplication: 'robotics-autonomous-systems',
	evaluationTimeline: 'within-3-months',
	currentApproach: 'internal-system',
	economicImpact: 'over-1m',
	budgetRange: '25k-50k',
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

const ROW: Lead = {
	id: 'lead-1',
	email: 'lead@example.com',
	invitedAt: null,
	invitedBy: null,
	activatedAt: null,
	reviewedAt: null,
	reviewedBy: null,
	updatesConfirmSentAt: null,
	updatesConfirmedAt: null,
	updatesUnsubscribedAt: null,
	updatesUnsubscribedBy: null,
	doNotContactAt: null,
	doNotContactBy: null,
	createdAt: new Date('2026-07-01T12:00:00Z'),
	submissions: [SUBMISSION],
	leadClass: 'priority-a',
	inviteState: 'not-invited',
	updatesState: 'none',
	conflicts: [],
	latestAt: new Date('2026-07-01T12:00:00Z'),
	needsReview: true
};

const RESEARCHER: Lead = {
	...ROW,
	id: 'lead-2',
	email: 'reader@example.com',
	submissions: [
		{
			...SUBMISSION,
			id: 'sub-2',
			leadId: 'lead-2',
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
		}
	],
	leadClass: 'research',
	// Already invited (DAR-67) — so one lead in the default fixture exercises the resend affordance.
	invitedAt: new Date('2026-07-03T09:00:00Z'),
	invitedBy: 'staff-1',
	activatedAt: null,
	inviteState: 'invited',
	// …and has answered the updates confirmation (DAR-139), so the default fixture carries two
	// different updates states rather than two copies of the empty one.
	updatesConfirmSentAt: new Date('2026-07-01T13:00:00Z'),
	updatesConfirmedAt: new Date('2026-07-01T13:05:00Z'),
	updatesState: 'confirmed'
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
	// Default OPERATOR, not admin — the lower privilege, so a control that should be admin-only shows
	// up in the default fixture if its gate is ever dropped.
	isAdmin: false,
	leads: [ROW, RESEARCHER],
	counts: { 'priority-a': 1, 'priority-b': 0, 'priority-c': 0, research: 1, investor: 0 },
	filter: null,
	total: 2,
	submissionTotal: 2,
	reviewTotal: 2,
	limit: 200,
	funnel: FUNNEL,
	conversion: 0.25,
	...over
});

/** Every POST form's action attribute, so the filter-carrying assertions can match exactly. */
const actionsOf = (container: HTMLElement, name: string) =>
	[...container.querySelectorAll('form[method="post"]')]
		.map((f) => f.getAttribute('action'))
		// Exact action name, not a prefix: `?/delete` is a prefix of `?/deleteSubmission`, so a
		// startsWith filter would silently conflate the "remove this claim" and "remove this person"
		// buttons — the two things the page most needs to keep apart.
		.filter((a) => a === `?/${name}` || a?.startsWith(`?/${name}&`));

const mount = (over?: Partial<PageFixture>, form: ActionData = null) =>
	render(AdminWaitlistPage, { data: data(over) as PageData, form });

describe('/admin/waitlist', () => {
	it('renders a badge, the row summary and the qualification detail for each signup', async () => {
		mount();

		await expect.element(page.getByText('Priority A', { exact: true }).first()).toBeVisible();
		await expect
			.element(page.getByText('Research / community', { exact: true }).first())
			.toBeVisible();
		await expect.element(page.getByRole('link', { name: 'lead@example.com' })).toBeVisible();
		// The label sets resolve rather than leaking a raw slug.
		// `.first()` throughout: the summary column and the submission's own answer grid both render
		// this value now, which is the point — the detail states what each submission said rather than
		// deferring to a single reconciled row.
		await expect
			.element(page.getByText('Engineering or technical leader', { exact: true }).first())
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

	// DAR-139. The per-submission "Marketing consent" row says what a submitter typed into an
	// unauthenticated form; this column says whether the mailbox itself answered, which is the only
	// thing that authorizes a send. Both fixtures ticked the box (SUBMISSION carries consentUpdates),
	// so a column that read the CLAIM instead of the lead state would show them identically — which is
	// what makes asserting two different labels here non-vacuous.
	it('separates a confirmed address from one that only ticked the box', async () => {
		mount();
		await expect.element(page.getByText('Confirmed', { exact: true })).toBeVisible();
		await expect.element(page.getByText('No request', { exact: true })).toBeVisible();
	});

	it('says an opted-out address has opted out', async () => {
		mount({
			leads: [
				{
					...ROW,
					updatesConfirmSentAt: new Date('2026-07-01T13:00:00Z'),
					updatesConfirmedAt: new Date('2026-07-01T13:05:00Z'),
					updatesUnsubscribedAt: new Date('2026-07-04T08:00:00Z'),
					updatesState: 'unsubscribed'
				}
			]
		});
		await expect.element(page.getByText('Opted out', { exact: true })).toBeVisible();
		expect(page.getByText('Confirmed', { exact: true }).elements()).toHaveLength(0);
	});

	// --- Recording an opt-out on someone's behalf (DAR-140) ---

	// The control exists for every state EXCEPT withdrawn, and `none` is the one worth naming: someone
	// whose address a stranger typed in has never been asked and wants never to be, so gating the
	// button on having asked would leave exactly that person unservable.
	it('offers the opt-out control for an address that has not withdrawn', async () => {
		const { container } = mount({ leads: [ROW] });

		expect(actionsOf(container, 'recordOptOut')).toEqual(['?/recordOptOut']);
		await expect.element(page.getByText('Record opt-out', { exact: true })).toBeVisible();
	});

	// The write is idempotent, so this is not a correctness gate — it is that a control which can only
	// ever be a no-op is noise in a column an operator scans under pressure. Asserting the FORM is
	// gone, not just the label, since the label is what a careless fix would hide.
	it('withholds it from an address that has already withdrawn', async () => {
		const { container } = mount({
			leads: [
				{
					...ROW,
					updatesUnsubscribedAt: new Date('2026-07-04T08:00:00Z'),
					updatesState: 'unsubscribed'
				}
			]
		});

		expect(actionsOf(container, 'recordOptOut')).toEqual([]);
		expect(page.getByText('Record opt-out', { exact: true }).elements()).toHaveLength(0);
	});

	// (The active-filter guarantee is asserted with its siblings in "carries the active filter into
	// every action" — that test's name is only true while every action is in it.)

	// A NULL RECORDER WITH A TIMESTAMP IS NOT MISSING DATA — it is the recipient having pressed the
	// emailed link, which is the strongest evidence we can hold. Rendering the usual em-dash there
	// would report our best record as an absence, and would read identically to a row we know nothing
	// about. Both fixtures are withdrawn, so the two labels are the only difference between them.
	//
	// The recorder is deliberately NOT `staff-1`: that is the RESEARCHER fixture's `invited_by`, so the
	// assertion would be satisfied by the invitation row and would keep passing against a detail panel
	// that never rendered this column at all.
	it('distinguishes a staff-recorded opt-out from one the recipient made themselves', async () => {
		mount({
			leads: [
				{
					...ROW,
					updatesUnsubscribedAt: new Date('2026-07-04T08:00:00Z'),
					updatesUnsubscribedBy: 'operator-9',
					updatesState: 'unsubscribed'
				},
				{
					...RESEARCHER,
					updatesUnsubscribedAt: new Date('2026-07-05T08:00:00Z'),
					updatesUnsubscribedBy: null,
					updatesState: 'unsubscribed'
				}
			]
		});

		await expect.element(page.getByText('operator-9', { exact: true })).toBeInTheDocument();
		await expect
			.element(page.getByText('The recipient, via the unsubscribe link', { exact: true }))
			.toBeInTheDocument();
	});

	// --- "Don't contact me" (DAR-191) ---------------------------------------------------------------

	// THE BADGE REPLACES THE CLAIM RATHER THAN JOINING IT. `contact_permission` in this column is an
	// answer somebody typed into an unauthenticated form; the flag is where the person themselves now
	// stands. The fixture is deliberately the one whose claim says "Authorized", so a cell that rendered
	// both — or that let the claim win — is caught rather than merely looking tidy.
	it('shows do-not-contact in place of the submitted contact permission', async () => {
		mount({ leads: [{ ...ROW, doNotContactAt: new Date('2026-07-30T12:00:00Z') }] });

		await expect.element(page.getByText('Do not contact', { exact: true })).toBeVisible();
		expect(page.getByText('Authorized', { exact: true }).elements()).toHaveLength(0);
	});

	// The invitation is the one live outreach surface, so the control goes rather than being left to be
	// refused on click — a button that errors reads as a bug, not as a decision. Asserting the FORM is
	// gone, not just the label: the label is what a careless fix would hide.
	it('withdraws the invite control for a flagged lead and says why', async () => {
		const { container } = mount({
			leads: [{ ...ROW, doNotContactAt: new Date('2026-07-30T12:00:00Z') }]
		});

		expect(actionsOf(container, 'invite')).toEqual([]);
		await expect
			.element(page.getByText('Invitations are off for this lead.', { exact: true }))
			.toBeVisible();
	});

	// …and the record control goes too, replaced by nothing for an operator. Same reasoning as the
	// opt-out's: a control that can only be a no-op is noise in a column scanned under pressure.
	it('withdraws the record control once one is on file', async () => {
		const { container } = mount({
			leads: [{ ...ROW, doNotContactAt: new Date('2026-07-30T12:00:00Z') }]
		});

		expect(actionsOf(container, 'recordDoNotContact')).toEqual([]);
	});

	// THE ASYMMETRY, rendered. An operator may record a request and may not lift one, so for them a
	// flagged row has no control at all; an admin gets the lift. Both halves asserted, because the
	// refusal alone passes against a page that never renders the control for anybody.
	it('offers the lift only to an admin', async () => {
		const flagged = [{ ...ROW, doNotContactAt: new Date('2026-07-30T12:00:00Z') }];

		const operator = mount({ leads: flagged });
		expect(actionsOf(operator.container, 'liftDoNotContact')).toEqual([]);
		expect(operator.container.textContent).not.toContain('Lift do-not-contact');

		const admin = mount({ leads: flagged, isAdmin: true, filter: 'priority-a' });
		expect(actionsOf(admin.container, 'liftDoNotContact')).toEqual([
			// …carrying the active filter, like every other action on the page.
			'?/liftDoNotContact&class=priority-a'
		]);
		expect(admin.container.textContent).toContain('Lift do-not-contact');
	});

	// An admin looking at an UNFLAGGED lead must not see a lift either — the two controls are mutually
	// exclusive, and without this the `isAdmin` branch could render both.
	it('offers an admin the record control, not the lift, for an unflagged lead', async () => {
		const { container } = mount({ leads: [ROW], isAdmin: true });

		expect(actionsOf(container, 'recordDoNotContact')).toEqual(['?/recordDoNotContact']);
		expect(actionsOf(container, 'liftDoNotContact')).toEqual([]);
	});

	// The trail somebody asking about their own record needs: when, and by whom. `operator-9` rather
	// than `staff-1` for the sibling block's reason — that value is the RESEARCHER fixture's
	// `invited_by`, so it would resolve to two elements and could pass against a panel that never
	// rendered this column.
	it('renders when a request was recorded and who recorded it', async () => {
		mount({
			leads: [
				{
					...ROW,
					doNotContactAt: new Date('2026-07-30T12:00:00Z'),
					doNotContactBy: 'operator-9'
				}
			]
		});

		await expect
			.element(page.getByText('Do-not-contact recorded', { exact: true }))
			.toBeInTheDocument();
		await expect.element(page.getByText('operator-9', { exact: true })).toBeInTheDocument();
	});

	// Its own namespace, for the sibling banner's reason — and one extra: record and lift SHARE it, so
	// the success line has to distinguish them itself rather than relying on which form was posted.
	it('tells a recorded request apart from a lifted one in the banner', () => {
		const recorded = mount(undefined, {
			doNotContact: { ok: true, email: 'lead@example.com' }
		});
		expect(recorded.container.textContent).toContain(
			'Do-not-contact recorded for lead@example.com'
		);
		expect(recorded.container.textContent).not.toContain('lifted');

		const lifted = mount(undefined, {
			doNotContact: { ok: true, email: 'lead@example.com', lifted: true }
		});
		expect(lifted.container.textContent).toContain('Do-not-contact lifted for lead@example.com');
	});

	// The standing note is the only place the two-axis rule is stated, and it exists BECAUSE the code
	// deliberately does not enforce it: recording one does not record the other, so an operator
	// honoring "stop everything" has to press both. Copy is the whole mechanism, so it is asserted.
	it('tells the operator the two consent axes are separate requests', async () => {
		const { container } = mount();
		expect(container.textContent).toContain('if they asked for both, record both');
	});

	// The banner's namespace. `recordOptOut`'s failure is NESTED under `optOut`, and that nesting is the
	// only thing keeping it out of the page's generic `'error' in form` banner — flatten it to
	// `{ error }` and an operator whose opt-out failed is told a SUBMISSION couldn't be deleted, a
	// message about the wrong row and the wrong verb on a page where one of those two is destructive.
	// (The delete/invite pair has the same guard, in the invitations block below.)
	it('keeps the delete error and the opt-out error apart', async () => {
		const flat = mount(undefined, { error: 'forbidden' });
		expect(flat.container.textContent).not.toContain("Couldn't record that opt-out");

		const nested = mount(undefined, { optOut: { error: 'not_found' } });
		expect(nested.container.textContent).toContain('That lead no longer exists');
		expect(nested.container.textContent).not.toContain("Couldn't delete that submission");
	});

	// The other branch of `optOutErrorMessage`, so "vanished" isn't the only message it can produce.
	it('falls back to the generic message for any other opt-out failure', async () => {
		const { container } = mount(undefined, { optOut: { error: 'forbidden' } });
		expect(container.textContent).toContain("Couldn't record that opt-out");
	});

	it('marks exactly one filter chip current and uses the band-specific empty state', async () => {
		const { container } = mount({ filter: 'priority-a', leads: [] });

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
		mount({ filter: 'priority-b', leads: [], total: 200, limit: 200 });

		await expect.element(page.getByText('No signups in this band.')).toBeVisible();
		await expect.element(page.getByText('Showing the 200 most recent.')).toBeVisible();
	});

	// `mode: 'json'` columns are typed by assertion, not validation. One row holding
	// valid-but-not-array JSON must not take the whole triage page down.
	it('survives a multi-select column that is not an array', async () => {
		mount({
			leads: [
				{
					...ROW,
					submissions: [{ ...SUBMISSION, adoptionEvidence: 'corrupted' as unknown as string[] }]
				}
			]
		});
		await expect.element(page.getByText('Priority A', { exact: true }).first()).toBeVisible();
	});

	// A bare `?/delete` resolves to /admin/waitlist?/delete and drops `class=`, bouncing the operator
	// out of the band they were working in.
	it('carries the active filter into every action', () => {
		const { container } = mount({ filter: 'priority-a' });
		// One of each per lead, plus one deleteSubmission per submission.
		expect(actionsOf(container, 'delete')).toEqual([
			'?/delete&class=priority-a',
			'?/delete&class=priority-a'
		]);
		expect(actionsOf(container, 'deleteSubmission')).toEqual([
			'?/deleteSubmission&class=priority-a',
			'?/deleteSubmission&class=priority-a'
		]);
		expect(actionsOf(container, 'review')).toEqual([
			'?/review&class=priority-a',
			'?/review&class=priority-a'
		]);
		// Neither default fixture has withdrawn, so both rows offer it (DAR-140).
		expect(actionsOf(container, 'recordOptOut')).toEqual([
			'?/recordOptOut&class=priority-a',
			'?/recordOptOut&class=priority-a'
		]);
		// Neither is flagged, so both rows offer it (DAR-191). Its lift twin is asserted in that block
		// instead: it needs a flagged lead AND an admin, so it cannot ride the default fixture.
		expect(actionsOf(container, 'recordDoNotContact')).toEqual([
			'?/recordDoNotContact&class=priority-a',
			'?/recordDoNotContact&class=priority-a'
		]);
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
	it('degrades to a note when the readout is unavailable, keeping the leads', async () => {
		mount({ funnel: null, conversion: null });

		await expect.element(page.getByText('Funnel counts are unavailable right now.')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'lead@example.com' })).toBeVisible();
		await expect.element(page.getByText('Priority A', { exact: true }).first()).toBeVisible();
	});

	// The readout sits on the same page as the leads, so it must stay a count of anonymous flows —
	// never a per-person breakdown, and never anything a row could be joined back to.
	it('keeps the readout free of any lead identity', async () => {
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
			leads: [
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
		expect(actionsOf(container, 'invite')).toEqual([
			'?/invite&class=priority-a',
			'?/invite&class=priority-a'
		]);
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

	// A disabled account needs the operator to go re-enable it, not to retry — and it must say so,
	// because setting a password does NOT restore access, so the invitation would otherwise look
	// successful right up to the sign-in the prospect still can't pass.
	it('explains a refusal to invite a disabled account', async () => {
		mount(undefined, { invite: { error: 'account_disabled' } });
		await expect.element(page.getByText(/account is disabled/)).toBeVisible();
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

// DAR-88 — a row is a PERSON with N submissions, and the view's job is to show them side by side
// without picking a winner. These cover the three things that only exist because of that.
describe('/admin/waitlist collated submissions', () => {
	// Two submissions under one address giving DIFFERENT contact destinations: exactly the case the
	// pre-DAR-88 store resolved in the write path (and destroyed the loser of). Both must be on screen.
	const CONFLICTED: Lead = {
		...ROW,
		submissions: [
			{
				...SUBMISSION,
				id: 'sub-new',
				name: 'Mallory',
				phone: '+1 555 9999',
				createdAt: new Date('2026-07-05T12:00:00Z')
			},
			{ ...SUBMISSION, id: 'sub-old', name: 'Ada Lovelace', phone: '+1 555 0100' }
		],
		conflicts: ['name', 'phone'],
		latestAt: new Date('2026-07-05T12:00:00Z'),
		needsReview: true
	};

	it('keeps every submission’s answers rather than merging them', async () => {
		mount({ leads: [CONFLICTED], total: 1, submissionTotal: 2, reviewTotal: 1 });

		// BOTH phone numbers are rendered. A merged view would show one and silently discard the other,
		// which is the behaviour this whole change removes.
		await expect.element(page.getByText('+1 555 9999')).toBeInTheDocument();
		await expect.element(page.getByText('+1 555 0100')).toBeInTheDocument();
		await expect.element(page.getByText('Mallory').first()).toBeInTheDocument();
		await expect.element(page.getByText('Ada Lovelace').first()).toBeInTheDocument();
	});

	// DAR-126 re-scoped the budget question from annual contract value to an initial evaluation, and
	// append-only means one lead can hold an answer to each. Both have to render as what they are: the
	// retired bands still resolve (a raw `25k-100k` beside a labelled band is the silent data loss the
	// re-banding could have caused) AND the annual one says so, because $25k–$100k a year and $25k–$50k
	// for a pilot are opposite buying signals and the operator has only the value to go on.
	it('labels a retired annual budget as annual, beside a current evaluation band', async () => {
		mount({
			leads: [
				{
					...ROW,
					submissions: [
						{ ...SUBMISSION, id: 'sub-new', budgetRange: '50k-100k' },
						{
							...SUBMISSION,
							id: 'sub-old',
							budgetRange: '25k-100k',
							createdAt: new Date('2026-06-01T12:00:00Z')
						}
					],
					// What the collator really returns for this lead: two different values in one column is
					// a conflict, and a cross-era pair is no exception — the marker sits on the label, so
					// the values below still read as themselves.
					conflicts: ['budgetRange'],
					latestAt: new Date('2026-07-01T12:00:00Z')
				}
			],
			total: 1,
			submissionTotal: 2,
			reviewTotal: 1
		});

		await expect.element(page.getByText('$25k–$100k (annual)').first()).toBeInTheDocument();
		await expect.element(page.getByText('$50k–$100k', { exact: true }).first()).toBeInTheDocument();
	});

	it('names the fields the submissions disagree about', async () => {
		mount({ leads: [CONFLICTED], total: 1, submissionTotal: 2, reviewTotal: 1 });
		await expect.element(page.getByText(/Answers disagree across submissions/)).toBeInTheDocument();
		await expect.element(page.getByText('2 conflicting', { exact: true })).toBeVisible();
	});

	it('counts the submissions on the lead and in the header', async () => {
		mount({ leads: [CONFLICTED], total: 1, submissionTotal: 2, reviewTotal: 1 });
		await expect.element(page.getByText('Leads: 1 · Submissions: 2')).toBeVisible();
		// The per-lead chip only appears when there is more than one — a "1 submission" badge on every
		// row would be noise.
		await expect.element(page.getByText('Submissions (2)').first()).toBeInTheDocument();
	});

	it('offers a delete for the lead and one per submission, and they are different actions', () => {
		const { container } = mount({ leads: [CONFLICTED], total: 1, submissionTotal: 2 });
		expect(actionsOf(container, 'delete')).toEqual(['?/delete']);
		expect(actionsOf(container, 'deleteSubmission')).toEqual([
			'?/deleteSubmission',
			'?/deleteSubmission'
		]);
	});

	it('flags a lead awaiting review and reports one that has been reviewed', async () => {
		mount({ leads: [CONFLICTED], total: 1, submissionTotal: 2, reviewTotal: 1 });
		await expect.element(page.getByText('Needs review', { exact: true }).first()).toBeVisible();
		await expect.element(page.getByText('1 awaiting review')).toBeVisible();

		mount(
			{
				leads: [
					{ ...CONFLICTED, reviewedAt: new Date('2026-07-06T12:00:00Z'), needsReview: false }
				],
				total: 1,
				submissionTotal: 2,
				reviewTotal: 0
			},
			null
		);
		await expect.element(page.getByText(/Reviewed /).first()).toBeInTheDocument();
	});

	// The two caveats that describe the model itself, next to the data they qualify.
	it('states that conflicts are flagged rather than merged, and that submissions append', async () => {
		mount();
		await expect.element(page.getByText(/flagged, never merged/)).toBeVisible();
		await expect.element(page.getByText(/append-only/)).toBeVisible();
	});
});
