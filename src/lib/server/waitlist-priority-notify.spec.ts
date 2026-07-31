import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import { waitlistLead } from './db/schema';
import { insertWaitlistSubmission, type WaitlistStepOutcome } from './waitlist-store';
import {
	buildWaitlistPriorityLeadEmail,
	captureWaitlistPriorityLead
} from './waitlist-priority-notify';
import type { CleanedWaitlist } from './waitlist';

// The email builder is pure and tested as such. `captureWaitlistPriorityLead` is NOT tested with a
// mocked store: its entire guarantee is "one email per lead, ever", and that guarantee lives in a
// WHERE clause, so a stubbed claim would test the wiring and assert nothing about the cap. Real
// in-memory libsql, stubbed `fetch` (the Resend wire) — the same split contact-notify.spec.ts uses.

const ORIGIN = 'https://darcstar.tech';

/** A submission that scores Priority A: authority role + immediate timeline + a positive pilot. */
const priorityA: WaitlistStepOutcome = {
	leadId: 'lead-placeholder',
	email: 'ada@example.com',
	name: 'Ada Lovelace',
	role: 'founder-executive',
	primaryApplication: 'robotics-autonomous-systems',
	evaluationTimeline: 'evaluating-now',
	pilotInterest: 'yes-within-3-months'
};

describe('buildWaitlistPriorityLeadEmail', () => {
	it('addresses info@, replies to the lead, and names the band in the subject', () => {
		const email = buildWaitlistPriorityLeadEmail(priorityA, ORIGIN);
		expect(email.to).toBe('info@darcstar.tech');
		expect(email.replyTo).toBe('ada@example.com');
		expect(email.subject).toContain('Priority A');
		expect(email.subject).toContain('ada@example.com');
	});

	it('explains the band with every rubric input, in English labels', () => {
		const email = buildWaitlistPriorityLeadEmail(priorityA, ORIGIN);
		expect(email.text).toContain('Name: Ada Lovelace');
		expect(email.text).toContain('Role: Founder / Executive');
		expect(email.text).toContain('Use case: Robotics / autonomous systems');
		expect(email.text).toContain('Timeline: Evaluating now');
		expect(email.text).toContain('Pilot interest: Yes — within 3 months');
	});

	it('canonicalizes a legacy v1 role, so the label matches the band it produced', () => {
		// `founder` is a v1 slug; the classifier reads it as `founder-executive`. Printing the raw slug
		// would leave the email disagreeing with the classification it is announcing.
		const email = buildWaitlistPriorityLeadEmail({ ...priorityA, role: 'founder' }, ORIGIN);
		expect(email.text).toContain('Role: Founder / Executive');
	});

	it('falls back to the raw value for a slug it has no label for', () => {
		const email = buildWaitlistPriorityLeadEmail(
			{ ...priorityA, primaryApplication: 'something-new' },
			ORIGIN
		);
		expect(email.text).toContain('Use case: something-new');
	});

	it('says "Not provided" rather than blanking an unanswered signal', () => {
		const email = buildWaitlistPriorityLeadEmail({ ...priorityA, name: null }, ORIGIN);
		expect(email.text).toContain('Name: Not provided');
	});

	it('links the triage page, filtered to the band', () => {
		const email = buildWaitlistPriorityLeadEmail(priorityA, ORIGIN);
		expect(email.text).toContain('https://darcstar.tech/admin/waitlist?class=priority-a');
		expect(email.html).toContain('href="https://darcstar.tech/admin/waitlist?class=priority-a"');
	});

	it('does not double the slash when ORIGIN carries a trailing one', () => {
		const email = buildWaitlistPriorityLeadEmail(priorityA, 'https://darcstar.tech/');
		expect(email.text).toContain('https://darcstar.tech/admin/waitlist');
		expect(email.text).not.toContain('tech//admin');
	});

	it('still names the page when ORIGIN is unset, rather than emitting a broken link', () => {
		// A misconfigured deploy shouldn't cost the notification — and `url.origin` is not an
		// acceptable fallback, since it follows the (forgeable) Host header.
		const email = buildWaitlistPriorityLeadEmail(priorityA, undefined);
		expect(email.text).toContain('/admin/waitlist');
		expect(email.html).not.toContain('href=');
	});

	it('tells the reader to invite, not merely that a lead exists', () => {
		// DAR-67 sends invitations from that page, so "a hot lead arrived" and "someone should invite
		// them" are one moment; the email points at the action.
		expect(buildWaitlistPriorityLeadEmail(priorityA, ORIGIN).text).toContain('Invite them');
	});

	it('carries the unverified-claims caveat', () => {
		const text = buildWaitlistPriorityLeadEmail(priorityA, ORIGIN).text;
		expect(text).toContain('unverified');
		expect(text).toContain('other submissions');
	});

	it('escapes caller-supplied text in the HTML body', () => {
		const email = buildWaitlistPriorityLeadEmail(
			{ ...priorityA, name: '<script>alert(1)</script>' },
			ORIGIN
		);
		expect(email.html).not.toContain('<script>');
		expect(email.html).toContain('&lt;script&gt;');
	});

	// --- DAR-65's money guardrail, reaching the mail ----------------------------------------------

	it('cannot print a budget or an economic-impact figure', () => {
		// The builder's input extends WaitlistLeadSignals, which omits those columns on purpose — so a
		// caller handing over a whole row still gets an email with no dollar figure in it. Asserted from
		// the outside, because "the type won't let you" is only true until someone widens the type.
		const withMoney = {
			...priorityA,
			economicImpact: 'over-1m',
			budgetRange: 'over-100k'
		} as WaitlistStepOutcome;
		const email = buildWaitlistPriorityLeadEmail(withMoney, ORIGIN);
		for (const rendered of [email.text, email.html]) {
			expect(rendered).not.toContain('over-1m');
			expect(rendered).not.toContain('over-100k');
			expect(rendered).not.toMatch(/budget/i);
			expect(rendered).not.toMatch(/economic/i);
			expect(rendered).not.toMatch(/\$/);
		}
	});
});

// --- captureWaitlistPriorityLead, against a real database ----------------------------------------

const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema }) as unknown as Db;

const base: CleanedWaitlist = {
	email: 'ada@example.com',
	name: 'Ada Lovelace',
	company: null,
	role: null,
	companySize: null,
	interest: null,
	hearAbout: null,
	phone: null,
	countryRegion: null,
	consentUpdates: false
};

const fetchMock = vi.fn();

/** Collect what the capture schedules, so a test can await work that is deliberately not awaited. */
function fakePlatform() {
	const scheduled: Promise<unknown>[] = [];
	const platform = {
		ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) }
	} as unknown as App.Platform;
	return { platform, settle: () => Promise.all(scheduled) };
}

const leadRow = async () => (await db.select().from(waitlistLead))[0];

beforeAll(async () => {
	await client.execute(
		`CREATE TABLE waitlist_lead (
			id text PRIMARY KEY NOT NULL,
			email text NOT NULL,
			invited_at integer, invited_by text, activated_at integer,
			priority_a_notified_at integer,
			updates_confirm_sent_at integer, updates_confirmed_at integer, updates_unsubscribed_at integer,
			updates_unsubscribed_by text,
			do_not_contact_at integer, do_not_contact_by text,
			reviewed_at integer, reviewed_by text,
			created_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
		)`
	);
	await client.execute(
		'CREATE UNIQUE INDEX waitlist_lead_email_idx ON waitlist_lead (lower(email))'
	);
	await client.execute(
		`CREATE TABLE waitlist_submission (
			id text PRIMARY KEY NOT NULL,
			lead_id text NOT NULL REFERENCES waitlist_lead(id) ON DELETE CASCADE,
			email text NOT NULL,
			name text, company text, role text, company_size text, interest text, hear_about text, phone text,
			country_region text,
			consent_updates integer DEFAULT 0 NOT NULL,
			consent_updates_at integer,
			primary_application text, evaluation_timeline text,
			current_approach text, economic_impact text, budget_range text, adoption_evidence text,
			pilot_interest text, deployment_scale text, contact_permission integer, contact_method text,
			research_preferences text,
			qualification_step integer,
			step_write_count integer, step_write_window_at integer,
			ip_hash text, user_agent text,
			created_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
			updated_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
		)`
	);
});

beforeEach(async () => {
	await client.execute('DELETE FROM waitlist_submission');
	await client.execute('DELETE FROM waitlist_lead');
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => client.close());

/** Seed a lead + submission and return an outcome pointing at it. */
async function seed(overrides: Partial<WaitlistStepOutcome> = {}): Promise<WaitlistStepOutcome> {
	await insertWaitlistSubmission(db, base, 'h', null);
	return { ...priorityA, ...overrides, leadId: (await leadRow()).id };
}

const env = { resendKey: 'test-key', origin: ORIGIN };

describe('captureWaitlistPriorityLead', () => {
	it('sends once for a Priority-A row and stamps the lead', async () => {
		const outcome = await seed();
		const { platform, settle } = fakePlatform();

		expect(captureWaitlistPriorityLead(db, platform, env, outcome)).toBeUndefined();
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.to).toBe('info@darcstar.tech');
		expect(body.subject).toContain('Priority A');
		expect((await leadRow()).priorityANotifiedAt).toBeInstanceOf(Date);
	});

	it('sends nothing the second time, however many submissions score A', async () => {
		// The one that matters: append-only lets a stranger pile submissions onto a known address, and
		// every one of them together must buy at most this single email.
		const outcome = await seed();
		const first = fakePlatform();
		captureWaitlistPriorityLead(db, first.platform, env, outcome);
		await first.settle();

		for (let i = 0; i < 5; i++) {
			const again = fakePlatform();
			captureWaitlistPriorityLead(db, again.platform, env, outcome);
			await again.settle();
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('sends once when concurrent step writes all classify A', async () => {
		// In flight together, so each would see a null if it read before writing — the reason the claim
		// is a WHERE predicate rather than a check.
		const outcome = await seed();
		const { platform, settle } = fakePlatform();
		for (let i = 0; i < 5; i++) captureWaitlistPriorityLead(db, platform, env, outcome);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not send — or spend the claim — for a row that is not Priority A', async () => {
		// Spending it here would be the worse failure: the lead's one notification would be gone before
		// they ever qualified, so the real step-4A submit would arrive in silence.
		const outcome = await seed({ pilotInterest: 'not-currently' });
		const { platform, settle } = fakePlatform();
		captureWaitlistPriorityLead(db, platform, env, outcome);
		await settle();

		expect(fetchMock).not.toHaveBeenCalled();
		expect((await leadRow()).priorityANotifiedAt).toBeNull();

		// …and the later qualifying write still gets its email.
		const later = fakePlatform();
		captureWaitlistPriorityLead(db, later.platform, env, {
			...outcome,
			pilotInterest: 'yes-within-3-months'
		});
		await later.settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not spend the claim when Resend is unconfigured', async () => {
		// A deploy with no key would otherwise burn every lead's one-and-only notification on sends
		// that never happen, and the column has no reset.
		const outcome = await seed();
		const { platform, settle } = fakePlatform();
		captureWaitlistPriorityLead(db, platform, { resendKey: undefined, origin: ORIGIN }, outcome);
		await settle();

		expect(fetchMock).not.toHaveBeenCalled();
		expect((await leadRow()).priorityANotifiedAt).toBeNull();
	});

	it('does nothing when the step write was refused (null outcome)', async () => {
		// Refused, gone, or a honeypot decoy token — all of them arrive here as null.
		await seed();
		const { platform, settle } = fakePlatform();
		captureWaitlistPriorityLead(db, platform, env, null);
		await settle();
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await leadRow()).priorityANotifiedAt).toBeNull();
	});

	it('swallows a Resend failure instead of failing the visitor’s step', async () => {
		const outcome = await seed();
		fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { platform, settle } = fakePlatform();

		expect(() => captureWaitlistPriorityLead(db, platform, env, outcome)).not.toThrow();
		await expect(settle()).resolves.toBeDefined();
		expect(errors).toHaveBeenCalled();
		// The claim stays spent — at-most-once is the property bought, and this is its stated cost. The
		// lead is still Priority A at the top of /admin/waitlist, which is where triage happens anyway.
		expect((await leadRow()).priorityANotifiedAt).toBeInstanceOf(Date);
		errors.mockRestore();
	});
});
