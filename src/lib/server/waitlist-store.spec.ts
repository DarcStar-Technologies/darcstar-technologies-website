import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import { waitlistLead, waitlistSubmission } from './db/schema';
import {
	applyWaitlistStep,
	claimPriorityLeadNotification,
	claimUpdatesConfirmSend,
	confirmUpdates,
	insertWaitlistSubmission,
	liftDoNotContact,
	readUpdatesAudience,
	readWaitlistTriageWindow,
	recordDoNotContact,
	unsubscribeUpdates,
	WAITLIST_STEP_WRITE_MAX,
	WAITLIST_STEP_WRITE_WINDOW_MS,
	WAITLIST_UPDATES_CONFIRM_WINDOW_MS
} from './waitlist-store';
import { mayReceiveUpdates, waitlistUpdatesState } from '$lib/waitlist-updates';
import { mayContactLead } from '$lib/waitlist-outreach';
import { findWaitlistInviteTarget } from './waitlist-invite';
import type { CleanedWaitlist } from './waitlist';

// Real DB integration test — the append-only insert + the `isNew` gate are the security-critical
// logic (the gate decides whether an email goes out; the pure specs can't reach it), so exercise them
// against an in-memory libsql. The v2 step updates (applyWaitlistStep) are covered here too: they're
// the only write path for the optional steps, and their guarantees (own-columns-only, own-row-only,
// monotonic step, no row creation) are what the continuation-token design leans on.
const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema }) as unknown as Db;

const base: CleanedWaitlist = {
	email: 'ada@example.com',
	name: null,
	company: null,
	role: null,
	companySize: null,
	interest: null,
	hearAbout: null,
	phone: null,
	countryRegion: null,
	consentUpdates: false
};

const leads = () => db.select().from(waitlistLead);
const rows = () => db.select().from(waitlistSubmission).orderBy(waitlistSubmission.createdAt);
const rowById = async (id: string) => (await rows()).find((r) => r.id === id);

beforeAll(async () => {
	// Mirror the schema's two waitlist tables. The unique index lives on the LEAD (that migration of
	// one index is the whole DAR-88 change at the DB layer) and the submission carries no uniqueness
	// at all; the perf indexes are irrelevant to these correctness tests.
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
});

afterAll(() => client.close());

describe('insertWaitlistSubmission', () => {
	it('reports isNew=true and stores one lead with one submission on a first signup', async () => {
		const r = await insertWaitlistSubmission(db, { ...base, name: 'Ada' }, 'hash1', 'ua');
		expect(r.isNew).toBe(true);

		expect(await leads()).toHaveLength(1);
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].email).toBe('ada@example.com');
		expect(all[0].name).toBe('Ada');
		expect(all[0].ipHash).toBe('hash1');
		expect(all[0].qualificationStep).toBe(1);
		// The returned id addresses the SUBMISSION — it is what the continuation token binds to.
		expect(all[0].id).toBe(r.id);
	});

	// --- The DAR-88 property, and the reason the write-policy helpers could be deleted -------------

	it('a repeat email APPENDS a submission under the same lead, never edits the first', async () => {
		const first = await insertWaitlistSubmission(
			db,
			{
				...base,
				name: 'Ada Lovelace',
				company: 'Acme',
				phone: '+1 555 0100',
				interest: 'Robotics'
			},
			'h',
			null
		);
		const before = await rowById(first.id);

		// Same address, different case — the lower(email) unique index on the LEAD must still resolve
		// it to one person — with entirely different answers, as a stranger who guessed the address
		// would supply.
		const second = await insertWaitlistSubmission(
			db,
			{
				...base,
				email: 'ADA@example.com',
				name: 'Mallory',
				company: 'Evil Corp',
				phone: '+1 555 9999',
				interest: 'Fleet logistics'
			},
			'other-ip',
			null
		);

		expect(second.isNew).toBe(false); // no second welcome email
		expect(await leads()).toHaveLength(1); // ONE person
		expect(await rows()).toHaveLength(2); // TWO submissions

		// The first submission is byte-identical. Before DAR-88 this was a policy question per column
		// (provided-wins? fill-forward?) and the losing value was destroyed; now the write simply
		// cannot reach it, so every column is safe for the same structural reason.
		expect(await rowById(first.id)).toEqual(before);

		// …and the stranger's answers are all present, on their own row, for a human to judge.
		const later = await rowById(second.id);
		expect(later?.name).toBe('Mallory');
		expect(later?.phone).toBe('+1 555 9999');
		expect(later?.email).toBe('ada@example.com'); // normalized on write
	});

	it('hands the second submitter a token for THEIR OWN row, not the first submitter’s', async () => {
		// The continuation token binds to the returned id. Pre-DAR-88 a repeat email returned the FIRST
		// submitter's row id, which is what let a stranger enrich someone else's record; the ids must
		// now differ.
		const first = await insertWaitlistSubmission(db, base, 'h', null);
		const second = await insertWaitlistSubmission(
			db,
			{ ...base, email: 'ADA@example.com' },
			'h',
			null
		);
		expect(second.id).not.toBe(first.id);
		expect(second.isNew).toBe(false); // …while still looking identical to the caller otherwise
	});

	it('keeps ONE lead when the same address arrives many times', async () => {
		for (let i = 0; i < 5; i++) {
			await insertWaitlistSubmission(db, { ...base, name: `Ada ${i}` }, 'h', null);
		}
		expect(await leads()).toHaveLength(1);
		expect(await rows()).toHaveLength(5);
	});

	it('resolves the lead when its stored email is not byte-lowercase', async () => {
		// Simulate an out-of-band lead whose stored email has uppercase bytes (import/console write —
		// the column has no lowercase constraint, only the functional unique index). A signup for the
		// lowercase form conflicts on lower(email); the read must match it via lower(email), NOT an
		// exact-equality key that would miss and spin (the recursion-DoS the two-pass loop guards).
		await client.execute(
			`INSERT INTO waitlist_lead (id, email) VALUES ('lead-mixed', 'Ada@Example.com')`
		);
		const r = await insertWaitlistSubmission(db, { ...base, company: 'Acme' }, 'h', null);
		expect(r.isNew).toBe(false);
		expect(await leads()).toHaveLength(1); // no duplicate lead inserted
		expect((await rowById(r.id))?.leadId).toBe('lead-mixed');
	});

	// --- The mailbomb gate ------------------------------------------------------------------------

	it('isNew is true EXACTLY ONCE per address, however many submissions follow', async () => {
		// This is the gate the welcome/ack emails hang off. Append-only makes "a row was created"
		// useless as evidence of a new person — every submit creates one — so the gate has to ride the
		// LEAD insert, and this pins that it does.
		const flags = [];
		for (let i = 0; i < 4; i++) {
			flags.push((await insertWaitlistSubmission(db, base, 'h', null)).isNew);
		}
		expect(flags).toEqual([true, false, false, false]);
	});

	it('two concurrent first-signups for one address yield exactly one isNew', async () => {
		// The DB decides, atomically, via insert…onConflictDoNothing().returning() against the unique
		// index — not a "have we seen this email?" read, which would race and mail twice.
		const results = await Promise.all([
			insertWaitlistSubmission(db, base, 'h', null),
			insertWaitlistSubmission(db, { ...base, email: 'ADA@example.com' }, 'h', null)
		]);
		expect(results.filter((r) => r.isNew)).toHaveLength(1);
		expect(await leads()).toHaveLength(1);
		expect(await rows()).toHaveLength(2); // both submissions still recorded
	});

	// --- Consent ----------------------------------------------------------------------------------

	it('records consent per submission, with its own timestamp, and never edits an earlier grant', async () => {
		// A submit WITHOUT consent — no grant, no timestamp.
		const plain = await insertWaitlistSubmission(db, base, 'h', null);
		expect((await rowById(plain.id))?.consentUpdates).toBe(false);
		expect((await rowById(plain.id))?.consentUpdatesAt).toBeNull();

		// A later submit WITH consent — recorded on ITS row, stamped, and provable against that row's
		// own ip_hash. Better evidence than the monotonic flag it replaces, which said only "someone,
		// once, ticked a box".
		const granted = await insertWaitlistSubmission(
			db,
			{ ...base, consentUpdates: true },
			'grant-ip',
			null
		);
		const grantRow = await rowById(granted.id);
		expect(grantRow?.consentUpdates).toBe(true);
		expect(grantRow?.consentUpdatesAt).toBeInstanceOf(Date);
		expect(grantRow?.ipHash).toBe('grant-ip');

		// The earlier row is untouched — no max()-ing a grant forward across submitters.
		expect((await rowById(plain.id))?.consentUpdates).toBe(false);

		// And an unticked box afterwards is its own "no", not a revocation of the grant above: each row
		// states what that submitter did, and nothing reaches across rows.
		const later = await insertWaitlistSubmission(db, { ...base, consentUpdates: false }, 'h', null);
		expect((await rowById(later.id))?.consentUpdates).toBe(false);
		expect((await rowById(granted.id))?.consentUpdates).toBe(true);
	});

	// /admin/waitlist's "delete this lead" relies on the schema's ON DELETE CASCADE to take the
	// submissions with it — deleting only the lead would leave rows nothing can reach. SQLite enforces
	// foreign keys only when `PRAGMA foreign_keys` is on, which libsql defaults to but the standard
	// SQLite default is OFF, so this pins the behaviour the action depends on rather than the DDL text.
	it('deleting a lead cascades to its submissions', async () => {
		const first = await insertWaitlistSubmission(db, base, 'h', null);
		await insertWaitlistSubmission(db, base, 'h', null);
		const leadId = (await rowById(first.id))!.leadId;
		expect(await rows()).toHaveLength(2);

		await client.execute({ sql: 'DELETE FROM waitlist_lead WHERE id = ?', args: [leadId] });
		expect(await rows()).toHaveLength(0);
	});
});

describe('applyWaitlistStep', () => {
	const insert = async () =>
		(await insertWaitlistSubmission(db, { ...base, name: 'Ada' }, 'h', null)).id;

	it('writes ONLY its own step columns — identity fields stay untouched', async () => {
		const id = await insert();
		const { updated } = await applyWaitlistStep(db, id, {
			step: 2,
			role: 'engineering-leader',
			primaryApplication: 'ai-agents-llm-systems',
			evaluationTimeline: 'evaluating-now'
		});
		expect(updated).toBe(true);
		const row = await rowById(id);
		expect(row?.email).toBe('ada@example.com'); // identity untouched
		expect(row?.name).toBe('Ada');
		expect(row?.role).toBe('engineering-leader');
		expect(row?.primaryApplication).toBe('ai-agents-llm-systems');
		expect(row?.evaluationTimeline).toBe('evaluating-now');
		expect(row?.qualificationStep).toBe(2);
	});

	it('touches only the submission its token addresses, not the lead’s other submissions', async () => {
		// The property that replaced DAR-59's per-column policies and DAR-72's phone/permission rules:
		// a token holder edits the row they created, so a stranger's step write lands on their own
		// submission and the real person's is untouchable — by construction, not by policy.
		const mine = await insertWaitlistSubmission(
			db,
			{ ...base, name: 'Ada', phone: '+1 555 0100' },
			'h',
			null
		);
		const theirs = await insertWaitlistSubmission(db, { ...base, name: 'Mallory' }, 'other', null);
		const before = await rowById(mine.id);

		await applyWaitlistStep(db, theirs.id, {
			step: '4a',
			pilotInterest: 'yes-within-3-months',
			deploymentScale: null,
			contactPermission: true,
			contactMethod: 'phone-video',
			phone: '+1 555 9999'
		});

		expect(await rowById(mine.id)).toEqual(before); // byte-identical
		const other = await rowById(theirs.id);
		expect(other?.phone).toBe('+1 555 9999'); // their claims land on their own row
		expect(other?.contactPermission).toBe(true);
	});

	it('round-trips the JSON multi-selects and applies keep-existing on a sparser resubmit', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: 3,
			currentApproach: 'manual-operation',
			economicImpact: '250k-1m',
			budgetRange: '25k-50k',
			adoptionEvidence: ['evaluation-pilot', 'third-party-review']
		});
		// A sparser step-3 resubmit (all null) must erase nothing. This is now a UX rule rather than a
		// security one — it stops a visitor losing their own answers by walking back through a step —
		// but the behaviour is unchanged.
		await applyWaitlistStep(db, id, {
			step: 3,
			currentApproach: null,
			economicImpact: null,
			budgetRange: null,
			adoptionEvidence: null
		});
		const row = await rowById(id);
		expect(row?.currentApproach).toBe('manual-operation');
		expect(row?.adoptionEvidence).toEqual(['evaluation-pilot', 'third-party-review']);
		expect(row?.qualificationStep).toBe(3);
	});

	it('4a: contact_permission is tri-state, provided-wins, and the step never rewinds', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'yes-within-6-months',
			deploymentScale: 'Two quadrotor cells, ~40 units',
			contactPermission: true,
			contactMethod: 'email',
			phone: null
		});
		expect((await rowById(id))?.qualificationStep).toBe(4);
		expect((await rowById(id))?.contactPermission).toBe(true);

		// Revisiting an EARLIER step must not rewind the high-water mark…
		await applyWaitlistStep(db, id, {
			step: 2,
			role: null,
			primaryApplication: null,
			evaluationTimeline: 'within-3-months'
		});
		// …and a later 4a where the question WASN'T shown (validator emits contactPermission=null) must
		// PRESERVE the standing answer — null means "not asked", never "no".
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: null,
			deploymentScale: null,
			contactPermission: null,
			contactMethod: null,
			phone: null
		});
		let row = await rowById(id);
		expect(row?.qualificationStep).toBe(4);
		expect(row?.evaluationTimeline).toBe('within-3-months');
		expect(row?.contactPermission).toBe(true);
		expect(row?.pilotInterest).toBe('yes-within-6-months');

		// An explicit decline (false — validator saw a positive pilot + unchecked box) writes. So would
		// a later grant: this row belongs to one submitter, and someone changing their own mind is the
		// only thing that can reach it. DAR-72's decline-wins asymmetry existed because that was NOT
		// true; it is now, so the rule is plain provided-wins.
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'possibly-contact-me',
			deploymentScale: null,
			contactPermission: false,
			contactMethod: null,
			phone: null
		});
		row = await rowById(id);
		expect(row?.contactPermission).toBe(false);

		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: null,
			deploymentScale: null,
			contactPermission: true,
			contactMethod: null,
			phone: null
		});
		expect((await rowById(id))?.contactPermission).toBe(true);
	});

	it('4a: a phone correction by the row’s own submitter lands', async () => {
		// The genuine-visitor case DAR-72 had to break (fill-forward silently dropped a correction) and
		// append-only restores: the only person who can reach this row is the one who created it.
		const id = (
			await insertWaitlistSubmission(db, { ...base, name: 'Ada', phone: '+1 555 0100' }, 'h', null)
		).id;
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'yes-within-3-months',
			deploymentScale: null,
			contactPermission: null,
			contactMethod: null,
			phone: '+1 555 0177'
		});
		expect((await rowById(id))?.phone).toBe('+1 555 0177');
	});

	it('stores step-4b research preferences', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: '4b',
			researchPreferences: ['technical-reports', 'open-source-releases']
		});
		const row = await rowById(id);
		expect(row?.researchPreferences).toEqual(['technical-reports', 'open-source-releases']);
		expect(row?.qualificationStep).toBe(4);
	});

	it('reports updated=false for an unknown id and NEVER creates a row (decoy-token path)', async () => {
		const { updated, outcome } = await applyWaitlistStep(db, crypto.randomUUID(), {
			step: 2,
			role: null,
			primaryApplication: null,
			evaluationTimeline: null
		});
		expect(updated).toBe(false);
		expect(outcome).toBeNull(); // nothing to classify — the Priority-A capture no-ops on this
		expect(await rows()).toHaveLength(0);
		expect(await leads()).toHaveLength(0); // and no lead either
	});

	// --- The post-update row DAR-82's notification classifies -------------------------------------

	it('returns the row AS IT NOW STANDS — this step’s answer plus what coalesce preserved', async () => {
		// The whole reason `outcome` can drive a transition check without a follow-up read: step 4A
		// writes only the pilot answer, but the returned row has to carry step 2's role and timeline
		// too, or nothing that classifies could be assembled from one step's write.
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: 2,
			role: 'founder-executive',
			primaryApplication: 'robotics-autonomous-systems',
			evaluationTimeline: 'evaluating-now'
		});

		const { outcome } = await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'yes-within-3-months',
			deploymentScale: null,
			contactPermission: null,
			contactMethod: null,
			phone: null
		});

		expect(outcome).toEqual({
			leadId: (await rowById(id))!.leadId,
			email: 'ada@example.com',
			name: 'Ada',
			role: 'founder-executive',
			primaryApplication: 'robotics-autonomous-systems',
			evaluationTimeline: 'evaluating-now',
			pilotInterest: 'yes-within-3-months'
		});
	});

	it('carries the lead id, so the notification claim needs no lookup', async () => {
		const inserted = await insertWaitlistSubmission(db, base, 'h', null);
		const { outcome } = await applyWaitlistStep(db, inserted.id, {
			step: '4b',
			researchPreferences: ['technical-reports']
		});
		expect(outcome?.leadId).toBe((await leads())[0].id);
	});
});

// DAR-82 — the Priority-A notification's one-per-lead cap. The whole guarantee lives in the WHERE
// clause, so it can only be tested against a real database.
describe('claimPriorityLeadNotification', () => {
	const insertLead = async () => (await insertWaitlistSubmission(db, base, 'h', null)).id;

	const notifiedAt = async () => (await leads())[0]?.priorityANotifiedAt ?? null;

	it('claims once and refuses every later attempt', async () => {
		await insertLead();
		const leadId = (await leads())[0].id;

		expect(await claimPriorityLeadNotification(db, leadId)).toBe(true);
		const stamped = await notifiedAt();
		expect(stamped).toBeInstanceOf(Date);

		expect(await claimPriorityLeadNotification(db, leadId)).toBe(false);
		expect(await claimPriorityLeadNotification(db, leadId)).toBe(false);
		// A refused claim leaves the original stamp alone — it records the notification that was
		// actually sent, not the last time someone tried.
		expect(await notifiedAt()).toEqual(stamped);
	});

	it('lets exactly one of N concurrent claims win', async () => {
		// The reason this is a WHERE predicate rather than a read-then-write: every one of these sees a
		// null if it looks first, so a procedural guard would send five emails.
		await insertLead();
		const leadId = (await leads())[0].id;

		const results = await Promise.all(
			Array.from({ length: 5 }, () => claimPriorityLeadNotification(db, leadId))
		);
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it('is per LEAD, so N submissions under one address still buy one notification', async () => {
		// Append-only accepts that a stranger can pile submissions onto a known address (DAR-88). This
		// is the bound on what that costs the info@ inbox.
		await insertLead();
		await insertWaitlistSubmission(db, { ...base, name: 'Mallory' }, 'other', null);
		await insertWaitlistSubmission(db, { ...base, name: 'Mallory' }, 'other', null);
		expect(await rows()).toHaveLength(3);
		expect(await leads()).toHaveLength(1);

		const leadId = (await leads())[0].id;
		expect(await claimPriorityLeadNotification(db, leadId)).toBe(true);
		expect(await claimPriorityLeadNotification(db, leadId)).toBe(false);
	});

	it('refuses a lead that no longer exists, without creating one', async () => {
		expect(await claimPriorityLeadNotification(db, crypto.randomUUID())).toBe(false);
		expect(await leads()).toHaveLength(0);
	});

	it('budgets each lead separately', async () => {
		await insertLead();
		await insertWaitlistSubmission(db, { ...base, email: 'grace@example.com' }, 'h', null);
		const [a, b] = await leads();

		expect(await claimPriorityLeadNotification(db, a.id)).toBe(true);
		expect(await claimPriorityLeadNotification(db, b.id)).toBe(true);
	});
});

// DAR-68 — the per-row step-write budget. Its threat model narrowed under DAR-88 (a token now
// addresses the row its own holder created, so this no longer stands between an attacker and someone
// else's data), but it still bounds how much write traffic one submission can absorb.
describe('applyWaitlistStep step-write budget', () => {
	const insert = async () =>
		(await insertWaitlistSubmission(db, { ...base, name: 'Ada' }, 'h', null)).id;

	// One well-formed step-2 write, with a distinguishable role so a REFUSED write can be told from
	// an applied one by looking at what is stored rather than only at the return value.
	const step2 = (id: string, role: string | null = 'engineering-leader') =>
		applyWaitlistStep(db, id, {
			step: 2,
			role,
			primaryApplication: null,
			evaluationTimeline: null
		});

	/** Age the row's window start so the fixed window has expired without waiting an hour. */
	const expireWindow = (id: string) =>
		client.execute({
			sql: 'UPDATE waitlist_submission SET step_write_window_at = ? WHERE id = ?',
			args: [Date.now() - WAITLIST_STEP_WRITE_WINDOW_MS - 60_000, id]
		});

	it('opens a window on the first step write and spends one unit per write', async () => {
		const id = await insert();
		await step2(id);
		const first = await rowById(id);
		expect(first?.stepWriteCount).toBe(1);
		expect(first?.stepWriteWindowAt).toBeInstanceOf(Date);

		// Move the window start to a known moment still INSIDE the window before the second write.
		// Without this the next assertion is intermittently blind: two consecutive writes can land in
		// the same millisecond, and then "the start didn't move" is true of a SLIDING window too —
		// measured, it misses the sliding mutation about one run in three. Pinning it half a window
		// back makes the two behaviours differ by half an hour.
		const pinned = Date.now() - WAITLIST_STEP_WRITE_WINDOW_MS / 2;
		await client.execute({
			sql: 'UPDATE waitlist_submission SET step_write_window_at = ? WHERE id = ?',
			args: [pinned, id]
		});

		await step2(id);
		const second = await rowById(id);
		expect(second?.stepWriteCount).toBe(2);
		// Fixed window, not sliding: a write inside a live window must not push its start forward, or
		// a steady drip would hold the window open indefinitely and the cap would never reset.
		expect(second?.stepWriteWindowAt?.getTime()).toBe(pinned);
	});

	it('refuses the write past the cap, and refuses it the SAME way a missing row is refused', async () => {
		const id = await insert();
		for (let i = 0; i < WAITLIST_STEP_WRITE_MAX; i++) expect((await step2(id)).updated).toBe(true);

		// Over budget. `updated: false` is the identical answer applyWaitlistStep gives for an id that
		// matches no row (the decoy-token path above), which is what keeps the throttle from being a
		// token-validity oracle: the caller cannot tell the two apart, and returns the same success.
		const over = await step2(id, 'researcher');
		expect(over.updated).toBe(false);

		const row = await rowById(id);
		expect(row?.role).toBe('engineering-leader'); // the refused answer was not applied
		expect(row?.stepWriteCount).toBe(WAITLIST_STEP_WRITE_MAX); // …and refusing did not spend budget either
	});

	it('leaves the row byte-identical when it refuses — including the window start', async () => {
		const id = await insert();
		for (let i = 0; i < WAITLIST_STEP_WRITE_MAX; i++) await step2(id);
		const before = await rowById(id);

		await step2(id, 'researcher');
		const after = await rowById(id);
		// Whole-row equality, not a field or two: a refusal is a zero-row UPDATE, so NOTHING may move —
		// not the answers, not qualification_step, not updated_at, and above all not step_write_window_at
		// (were a refusal to stamp the window, hammering would keep resetting the clock and the row could
		// never recover its budget). Comparing the whole row is also what makes this test able to fail:
		// the window start alone can't detect a broken guard, since a PERMITTED in-window write leaves it
		// untouched too.
		expect(after).toEqual(before);
	});

	it('restores the budget once the window expires', async () => {
		const id = await insert();
		for (let i = 0; i < WAITLIST_STEP_WRITE_MAX; i++) await step2(id);
		expect((await step2(id)).updated).toBe(false);

		await expireWindow(id);

		const resumed = await step2(id, 'researcher');
		expect(resumed.updated).toBe(true);
		const row = await rowById(id);
		expect(row?.role).toBe('researcher');
		expect(row?.stepWriteCount).toBe(1); // a fresh window starts the count over, it does not resume
	});

	it('treats a row with null counters as having a full budget', async () => {
		const id = await insert();
		await client.execute({
			sql: 'UPDATE waitlist_submission SET step_write_count = NULL, step_write_window_at = NULL WHERE id = ?',
			args: [id]
		});
		const { updated } = await step2(id);
		expect(updated).toBe(true);
		expect((await rowById(id))?.stepWriteCount).toBe(1);
	});

	it('budgets each submission separately, so one exhausted row does not block another', async () => {
		// The cap is per ROW, and under append-only a row is one visit. Someone who fills the form
		// twice must not find their second attempt pre-throttled by their first.
		const first = await insert();
		for (let i = 0; i < WAITLIST_STEP_WRITE_MAX; i++) await step2(first);
		expect((await step2(first)).updated).toBe(false);

		const second = await insert(); // same email, new submission
		expect((await step2(second)).updated).toBe(true);
	});

	// A refusal is SILENT — the endpoints return the same generic success either way — so a cap set
	// near a real visitor's ceiling would eat their answers with nothing to show for it. The whole
	// flow is three writes; this pins that the cap leaves room for walking back through all of them
	// several times over, so a future tightening has to break a test rather than a visitor.
	it('leaves generous headroom above a complete flow (2 → 3 → 4)', async () => {
		const id = await insert();
		const walk = async () => {
			await applyWaitlistStep(db, id, {
				step: 2,
				role: 'engineering-leader',
				primaryApplication: null,
				evaluationTimeline: null
			});
			await applyWaitlistStep(db, id, {
				step: 3,
				currentApproach: null,
				economicImpact: null,
				budgetRange: null,
				adoptionEvidence: ['internal-benchmarks']
			});
			return applyWaitlistStep(db, id, {
				step: '4a',
				pilotInterest: 'yes-interested',
				deploymentScale: null,
				contactPermission: null,
				contactMethod: null,
				phone: null
			});
		};
		for (let pass = 0; pass < 5; pass++) expect((await walk()).updated).toBe(true);
	});
});

// The /admin/waitlist read. Specced here because it carries a hand-written correlated-subquery
// ordering rule, and nothing in CI renders that page with data — the e2e suite has neither a session
// nor a reachable DB, so an untested fragment could only fail in production.
describe('readWaitlistTriageWindow', () => {
	/** Seed a lead created at `createdAt` with submissions at the given moments. */
	const seed = async (email: string, createdAt: number, submissionsAt: number[]) => {
		const leadId = `lead-${email}`;
		await client.execute({
			sql: 'INSERT INTO waitlist_lead (id, email, created_at) VALUES (?, ?, ?)',
			args: [leadId, email, createdAt]
		});
		for (const at of submissionsAt) {
			await client.execute({
				sql: 'INSERT INTO waitlist_submission (id, lead_id, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
				args: [`sub-${email}-${at}`, leadId, email, at, at]
			});
		}
		return leadId;
	};

	it('orders by LAST ACTIVITY, not by when the lead was created', async () => {
		// `old` signed up first and has just submitted again; `recent` signed up later and went quiet.
		// Ordering by lead creation would put `recent` first and, at the cap, hide `old` entirely — the
		// returning prospect being exactly the row append-only exists to capture.
		await seed('old@example.com', 1_000, [1_000, 9_000]);
		await seed('recent@example.com', 5_000, [5_000]);

		const { leads } = await readWaitlistTriageWindow(db, 10);
		expect(leads.map((l) => l.email)).toEqual(['old@example.com', 'recent@example.com']);
	});

	it('caps LEADS, not submissions, so one repeat submitter cannot fill the window', async () => {
		await seed('chatty@example.com', 1_000, [1_000, 2_000, 3_000, 4_000, 5_000]);
		await seed('quiet@example.com', 900, [900]);

		const { leads, submissions } = await readWaitlistTriageWindow(db, 2);
		expect(leads).toHaveLength(2);
		expect(submissions).toHaveLength(6); // every submission of both windowed leads
	});

	it('returns only the windowed leads’ submissions', async () => {
		await seed('in@example.com', 1_000, [9_000]);
		await seed('out@example.com', 1_000, [1_000]);

		const { leads, submissions } = await readWaitlistTriageWindow(db, 1);
		expect(leads.map((l) => l.email)).toEqual(['in@example.com']);
		expect(submissions.every((s) => s.leadId === leads[0].id)).toBe(true);
	});

	it('still returns a lead with no submissions, sorted by its own creation', async () => {
		// Reachable only if a submission insert failed after its lead was created. Dropping it would
		// hide it; an operator needs to see and delete it. `coalesce` is what keeps it from sorting last
		// forever behind a null.
		await seed('orphan@example.com', 8_000, []);
		await seed('normal@example.com', 1_000, [2_000]);

		const { leads, submissions } = await readWaitlistTriageWindow(db, 10);
		expect(leads.map((l) => l.email)).toEqual(['orphan@example.com', 'normal@example.com']);
		expect(submissions).toHaveLength(1);
	});

	it('issues no second query when the window is empty', async () => {
		const { leads, submissions } = await readWaitlistTriageWindow(db, 10);
		expect(leads).toEqual([]);
		expect(submissions).toEqual([]);
	});
});

// DAR-139 — the sending gate. /privacy promises publicly that a ticked box does not authorize a send,
// so these are the tests that back a public claim: what may be asked, what counts as an answer, and
// what a withdrawal costs someone who wants to bring the address back through the form.
describe('the updates sending gate', () => {
	/** Sign up once and hand back the lead the submission landed under. */
	const signup = async (over: Partial<CleanedWaitlist> = {}) =>
		(await insertWaitlistSubmission(db, { ...base, ...over }, 'h', null)).leadId;

	const lead = async () => (await leads())[0];

	/** Backdate the last ask, so the window can be tested without waiting a day. */
	const askedAgo = (leadId: string, ms: number) =>
		client.execute({
			sql: `UPDATE waitlist_lead
			      SET updates_confirm_sent_at = (cast(unixepoch('subsecond') * 1000 as integer)) - ?
			      WHERE id = ?`,
			args: [ms, leadId]
		});

	describe('claimUpdatesConfirmSend', () => {
		it('claims the first ask and stamps when we asked', async () => {
			const leadId = await signup({ consentUpdates: true });
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(true);
			expect((await lead()).updatesConfirmSentAt).toBeInstanceOf(Date);
		});

		// THE RATE CAP. A stranger can pile submissions onto a known address (append-only accepts that),
		// so without this every one of them would put another email in that person's inbox.
		it('refuses a second ask inside the window, however many submissions arrive', async () => {
			const leadId = await signup({ consentUpdates: true });
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(true);
			const asked = (await lead()).updatesConfirmSentAt;

			await signup({ consentUpdates: true });
			await signup({ consentUpdates: true });
			expect(await rows()).toHaveLength(3);
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(false);
			// …and a refused ask leaves the stamp alone, so hammering cannot walk the window forward.
			expect((await lead()).updatesConfirmSentAt).toEqual(asked);
		});

		it('asks again once the window has passed', async () => {
			const leadId = await signup({ consentUpdates: true });
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(true);
			await askedAgo(leadId, WAITLIST_UPDATES_CONFIRM_WINDOW_MS + 1_000);
			// A person who never received the first one must be able to re-tick and be asked again —
			// which is why this is a window and not DAR-82's once-ever claim.
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(true);
		});

		it('never asks an address that has already confirmed', async () => {
			const leadId = await signup({ consentUpdates: true });
			await confirmUpdates(db, leadId);
			await askedAgo(leadId, WAITLIST_UPDATES_CONFIRM_WINDOW_MS + 1_000);
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(false);
		});

		// THE DURABLE HALF, and the one a mutation to the WHERE clause silently removes: without it the
		// form — the single surface a stranger controls — could restart the asks for someone who
		// explicitly opted out, and unsubscribing would stop one message instead of the relationship.
		it('never asks an address that has withdrawn, however long ago and however often they re-tick', async () => {
			const leadId = await signup({ consentUpdates: true });
			await unsubscribeUpdates(db, leadId, null);

			await askedAgo(leadId, WAITLIST_UPDATES_CONFIRM_WINDOW_MS * 400);
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(false);
			await signup({ consentUpdates: true });
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(false);
		});

		it('lets exactly one of N concurrent claims win', async () => {
			// Same reason this is a WHERE predicate rather than a read-then-write as DAR-82's claim: all
			// five see an unasked lead if they look first.
			const leadId = await signup({ consentUpdates: true });
			const results = await Promise.all(
				Array.from({ length: 5 }, () => claimUpdatesConfirmSend(db, leadId))
			);
			expect(results.filter(Boolean)).toHaveLength(1);
		});

		it('refuses a lead that no longer exists, without creating one', async () => {
			expect(await claimUpdatesConfirmSend(db, crypto.randomUUID())).toBe(false);
			expect(await leads()).toHaveLength(0);
		});

		it('budgets each address separately', async () => {
			const a = await signup({ consentUpdates: true });
			const b = await signup({ email: 'grace@example.com', consentUpdates: true });
			expect(await claimUpdatesConfirmSend(db, a)).toBe(true);
			expect(await claimUpdatesConfirmSend(db, b)).toBe(true);
		});
	});

	describe('confirmUpdates', () => {
		it('records the answer and reports the state back', async () => {
			const leadId = await signup({ consentUpdates: true });
			await claimUpdatesConfirmSend(db, leadId);

			const after = await confirmUpdates(db, leadId);
			expect(after).not.toBeNull();
			expect(waitlistUpdatesState(after!)).toBe('confirmed');
			expect(mayReceiveUpdates(after!)).toBe(true);
		});

		it('is idempotent — a second click keeps the first confirmation’s timestamp', async () => {
			const leadId = await signup({ consentUpdates: true });
			const first = await confirmUpdates(db, leadId);
			const second = await confirmUpdates(db, leadId);
			expect(second!.updatesConfirmedAt).toEqual(first!.updatesConfirmedAt);
		});

		// The user-facing half of the durable withdrawal: an old confirmation link found afterwards
		// reports the opt-out rather than reversing it, and the caller can say so because the write
		// hands back the state instead of a boolean it would have to interpret.
		it('does not re-subscribe an address that has withdrawn', async () => {
			const leadId = await signup({ consentUpdates: true });
			await unsubscribeUpdates(db, leadId, null);

			const after = await confirmUpdates(db, leadId);
			expect(waitlistUpdatesState(after!)).toBe('unsubscribed');
			expect(after!.updatesConfirmedAt).toBeNull();
			expect(mayReceiveUpdates(after!)).toBe(false);
		});

		it('reports null for a lead that no longer exists, without creating one', async () => {
			expect(await confirmUpdates(db, crypto.randomUUID())).toBeNull();
			expect(await leads()).toHaveLength(0);
		});
	});

	describe('unsubscribeUpdates', () => {
		it('withdraws a confirmed address and keeps the confirmation as the audit trail', async () => {
			const leadId = await signup({ consentUpdates: true });
			await confirmUpdates(db, leadId);

			const after = await unsubscribeUpdates(db, leadId, null);
			expect(waitlistUpdatesState(after!)).toBe('unsubscribed');
			expect(mayReceiveUpdates(after!)).toBe(false);
			// Kept on purpose — the record of what actually happened. Clearing it would destroy evidence
			// to buy nothing, since the state already excludes them.
			expect(after!.updatesConfirmedAt).toBeInstanceOf(Date);
		});

		// Unconditional on purpose: the confirmation request itself carries this link, so the person
		// most likely to click it is someone whose address a stranger typed in and who has confirmed
		// nothing at all.
		it('withdraws an address that was never confirmed', async () => {
			const leadId = await signup({ consentUpdates: true });
			await claimUpdatesConfirmSend(db, leadId);
			const after = await unsubscribeUpdates(db, leadId, null);
			expect(waitlistUpdatesState(after!)).toBe('unsubscribed');
		});

		it('is monotonic — re-clicking never rewrites when they opted out', async () => {
			const leadId = await signup({ consentUpdates: true });
			const first = await unsubscribeUpdates(db, leadId, null);
			const second = await unsubscribeUpdates(db, leadId, null);
			expect(second!.updatesUnsubscribedAt).toEqual(first!.updatesUnsubscribedAt);
		});

		it('reports null for a lead that no longer exists, without creating one', async () => {
			expect(await unsubscribeUpdates(db, crypto.randomUUID(), null)).toBeNull();
			expect(await leads()).toHaveLength(0);
		});

		// --- Who recorded it (DAR-140) ---
		// Two callers reach this now: the emailed link (`null` — the mailbox itself), and /admin/waitlist
		// recording a request that arrived by reply or phone. The column is the only place that
		// distinction survives, and it stopped being inferable from the timestamp the moment the second
		// caller existed.

		it('records the staff actor beside the timestamp', async () => {
			const leadId = await signup({ consentUpdates: true });
			const after = await unsubscribeUpdates(db, leadId, 'operator-7');
			expect(waitlistUpdatesState(after!)).toBe('unsubscribed');
			const [row] = await leads();
			expect(row.updatesUnsubscribedBy).toBe('operator-7');
			expect(row.updatesUnsubscribedAt).toBeInstanceOf(Date);
		});

		it('leaves the actor null when the recipient used the link themselves', async () => {
			const leadId = await signup({ consentUpdates: true });
			await unsubscribeUpdates(db, leadId, null);
			expect((await leads())[0].updatesUnsubscribedBy).toBeNull();
		});

		// THE MUTATION TARGET, and the reason the actor is written under the timestamp's own
		// first-writer-wins guard rather than `coalesce`d on its own value: null is MEANINGFUL here, so a
		// `coalesce(updates_unsubscribed_by, <staff id>)` would overwrite it on the first operator press
		// and the row would then claim we did what the person had already done for themselves — the one
		// direction that turns the audit trail into a false one.
		it('keeps the recipient as the recorder when staff press the button afterwards', async () => {
			const leadId = await signup({ consentUpdates: true });
			const first = await unsubscribeUpdates(db, leadId, null);
			const second = await unsubscribeUpdates(db, leadId, 'operator-7');
			expect((await leads())[0].updatesUnsubscribedBy).toBeNull();
			expect(second!.updatesUnsubscribedAt).toEqual(first!.updatesUnsubscribedAt);
		});

		// The same rule in the other direction — a later self-service click must not erase the record of
		// the operator who acted first, which is what a bare `${recordedBy}` with no guard would do.
		it('keeps the first operator when the recipient clicks the link afterwards', async () => {
			const leadId = await signup({ consentUpdates: true });
			await unsubscribeUpdates(db, leadId, 'operator-7');
			await unsubscribeUpdates(db, leadId, null);
			expect((await leads())[0].updatesUnsubscribedBy).toBe('operator-7');
		});

		// The admin action names the address it just acted on, and an irreversible one-click write has
		// to (DAR-67's rule for the invite). Read from the row rather than from the form, so it names
		// the row that was actually written.
		it('reports the address it withdrew', async () => {
			const leadId = await signup({ email: 'grace@example.com', consentUpdates: true });
			expect((await unsubscribeUpdates(db, leadId, 'operator-7'))!.email).toBe('grace@example.com');
		});
	});

	describe('readUpdatesAudience', () => {
		it('is empty until somebody confirms, whatever the tick boxes say', async () => {
			await signup({ consentUpdates: true });
			await signup({ email: 'grace@example.com', consentUpdates: true });
			// Two submissions claiming consent, and nobody has answered an email yet.
			expect(await readUpdatesAudience(db)).toEqual([]);
		});

		it('holds exactly the confirmed, un-withdrawn addresses', async () => {
			const ada = await signup({ consentUpdates: true });
			const grace = await signup({ email: 'grace@example.com', consentUpdates: true });
			await signup({ email: 'mallory@example.com', consentUpdates: true });

			await confirmUpdates(db, ada);
			await confirmUpdates(db, grace);
			await unsubscribeUpdates(db, grace, null);

			expect((await readUpdatesAudience(db)).map((r) => r.email)).toEqual(['ada@example.com']);
		});

		// THE PIN. `mayReceiveUpdates` and this query are two encodings of one rule and cannot be
		// single-sourced — one of them is SQL, DAR-71's situation for the `noIndex` filter that lives
		// half in GROQ. So they are held against each other across every state a lead can be in, which
		// is what turns a drift into a failing test instead of an audience that quietly includes
		// somebody who opted out.
		it('agrees with mayReceiveUpdates on every state a lead can be in', async () => {
			const cases = [
				{ email: 'none@example.com', ask: false, confirm: false, withdraw: false },
				{ email: 'asked@example.com', ask: true, confirm: false, withdraw: false },
				{ email: 'confirmed@example.com', ask: true, confirm: true, withdraw: false },
				{ email: 'gone@example.com', ask: true, confirm: true, withdraw: true },
				// Withdrew without ever confirming — the "a stranger used my address" path.
				{ email: 'never@example.com', ask: true, confirm: false, withdraw: true }
			];
			for (const c of cases) {
				const leadId = await signup({ email: c.email, consentUpdates: true });
				if (c.ask) await claimUpdatesConfirmSend(db, leadId);
				if (c.confirm) await confirmUpdates(db, leadId);
				if (c.withdraw) await unsubscribeUpdates(db, leadId, null);
			}

			const predicate = (await leads()).filter(mayReceiveUpdates).map((l) => l.email);
			const query = (await readUpdatesAudience(db)).map((r) => r.email);
			expect(query).toEqual(predicate.sort());
			// Non-vacuous in both directions: some leads are in and some are out.
			expect(query).toEqual(['confirmed@example.com']);
			expect(await leads()).toHaveLength(cases.length);
		});
	});
});

// ---------------------------------------------------------------------------------------------
// "Don't contact me" (DAR-191)
//
// The second consent axis. What has to be true of it is mostly NEGATIVE — three writes elsewhere stop
// happening — and negative claims about SQL are exactly what a pure spec cannot make, so this runs
// against the same real engine as the gate above.
// ---------------------------------------------------------------------------------------------
describe('the outreach do-not-contact flag', () => {
	const signup = async (over: Partial<CleanedWaitlist> = {}) =>
		(await insertWaitlistSubmission(db, { ...base, ...over }, 'h', null)).leadId;

	const lead = async () => (await leads())[0];

	describe('recordDoNotContact', () => {
		it('stamps the request and the operator who recorded it', async () => {
			const leadId = await signup();

			const row = await recordDoNotContact(db, leadId, 'staff-1');

			expect(row?.email).toBe('ada@example.com');
			expect(row?.doNotContactAt).toBeInstanceOf(Date);
			expect((await lead()).doNotContactBy).toBe('staff-1');
		});

		// MONOTONIC, and the actor moves with the timestamp rather than on its own. `unsubscribeUpdates`
		// had this exact bug found by mutation: `coalesce(do_not_contact_by, <staff id>)` type-checks,
		// passes a naive test, and overwrites a null that MEANS something — here, reserved for a mailbox
		// acting for itself. Asserted in both directions, because a single direction passes against an
		// unguarded write that simply happens to be called once.
		it('keeps the first recorder, whoever presses afterwards', async () => {
			const leadId = await signup();
			await recordDoNotContact(db, leadId, 'staff-1');
			const first = (await lead()).doNotContactAt;

			await recordDoNotContact(db, leadId, 'staff-2');

			const after = await lead();
			expect(after.doNotContactBy).toBe('staff-1');
			expect(after.doNotContactAt).toEqual(first);
		});

		it('keeps a null recorder rather than replacing it with a staff id', async () => {
			const leadId = await signup();
			// The reserved shape: the person themselves, via a channel that names no operator.
			await recordDoNotContact(db, leadId, null);

			await recordDoNotContact(db, leadId, 'staff-1');

			expect((await lead()).doNotContactBy).toBeNull();
		});

		it('reports a lead that is already gone', async () => {
			expect(await recordDoNotContact(db, 'nope', 'staff-1')).toBeNull();
		});
	});

	// THE POINT OF THE COLUMN — three writes that stop happening. Each is a `WHERE` predicate on a
	// statement that was already being issued, so what is under test is the SQL rather than a branch,
	// and each pairs its refusal with the unflagged control: "the claim returned false" is vacuously
	// satisfiable by a claim that never works at all.
	describe('what it suppresses', () => {
		it('refuses the Priority-A notification, which exists to prompt an invitation', async () => {
			const flagged = await signup();
			const ordinary = await signup({ email: 'grace@example.com' });
			await recordDoNotContact(db, flagged, 'staff-1');

			expect(await claimPriorityLeadNotification(db, flagged)).toBe(false);
			expect(await claimPriorityLeadNotification(db, ordinary)).toBe(true);
		});

		// DAR-83's uniformity rule. This ask is the one piece of mail a STRANGER can cause us to send to
		// an address that has confirmed nothing, so leaving it open would let somebody re-type the
		// address of the very person who asked us to stop and put us back in their inbox.
		it('refuses the updates confirmation request', async () => {
			const flagged = await signup({ consentUpdates: true });
			const ordinary = await signup({ email: 'grace@example.com', consentUpdates: true });
			await recordDoNotContact(db, flagged, 'staff-1');

			expect(await claimUpdatesConfirmSend(db, flagged)).toBe(false);
			expect(await claimUpdatesConfirmSend(db, ordinary)).toBe(true);
		});

		// The invite's refusal is a branch in the action, but the FIELD it branches on comes from here —
		// and the action cannot refuse what the query never returned.
		it('rides along on the invite lookup', async () => {
			const leadId = await signup();
			expect((await findWaitlistInviteTarget(db, leadId))?.doNotContactAt).toBeNull();

			await recordDoNotContact(db, leadId, 'staff-1');

			const target = await findWaitlistInviteTarget(db, leadId);
			expect(target?.doNotContactAt).toBeInstanceOf(Date);
			expect(mayContactLead(target!)).toBe(false);
		});

		// THE OTHER HALF, and it is a decision rather than an omission. A confirmed subscription is a
		// grant this mailbox made and can revoke from any message; "don't contact me about a pilot" is
		// not "cancel my newsletter", so conflating them would silently destroy the strongest consent
		// signal we hold. Someone who asked for both gets both recorded.
		it('leaves a confirmed updates subscription alone', async () => {
			const leadId = await signup({ consentUpdates: true });
			await claimUpdatesConfirmSend(db, leadId);
			await confirmUpdates(db, leadId);

			await recordDoNotContact(db, leadId, 'staff-1');

			expect(mayReceiveUpdates(await lead())).toBe(true);
			expect((await readUpdatesAudience(db)).map((r) => r.email)).toEqual(['ada@example.com']);
		});
	});

	describe('liftDoNotContact', () => {
		// Admin-only at the call site — see the action. What matters here is that lifting genuinely
		// restores every suppressed write, not merely the badge: a lift that cleared the column while
		// something stayed refused would be worse than no lift, since the operator would have no way to
		// see why.
		it('restores every write the flag suppressed', async () => {
			const leadId = await signup({ consentUpdates: true });
			await recordDoNotContact(db, leadId, 'staff-1');

			const row = await liftDoNotContact(db, leadId);

			expect(row?.email).toBe('ada@example.com');
			const after = await lead();
			expect(after.doNotContactAt).toBeNull();
			// Cleared TOGETHER: a stale recorder beside a null timestamp would read as a live request in
			// the detail panel while every gate had reopened.
			expect(after.doNotContactBy).toBeNull();
			expect(mayContactLead(after)).toBe(true);
			expect(await claimUpdatesConfirmSend(db, leadId)).toBe(true);
			expect(await claimPriorityLeadNotification(db, leadId)).toBe(true);
		});

		it('lets a lifted lead be recorded again, with the new recorder', async () => {
			const leadId = await signup();
			await recordDoNotContact(db, leadId, 'staff-1');
			await liftDoNotContact(db, leadId);

			await recordDoNotContact(db, leadId, 'staff-2');

			// First-writer-wins is scoped to a LIVE request, not to the row's whole history — otherwise a
			// lift would leave the flag un-re-recordable, which is the opposite of what it is for.
			expect((await lead()).doNotContactBy).toBe('staff-2');
		});

		it('reports a lead that is already gone', async () => {
			expect(await liftDoNotContact(db, 'nope')).toBeNull();
		});
	});
});
