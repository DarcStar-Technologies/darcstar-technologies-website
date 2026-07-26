import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import { waitlist } from './db/schema';
import {
	applyWaitlistStep,
	upsertWaitlist,
	WAITLIST_STEP_WRITE_MAX,
	WAITLIST_STEP_WRITE_WINDOW_MS
} from './waitlist-store';
import type { CleanedWaitlist } from './waitlist';

// Real DB integration test — the insert-or-enrich + `isNew` gate is the security-critical logic
// (gates the emails; the pure specs can't reach it), so exercise it against an in-memory libsql.
// The v2 step updates (applyWaitlistStep) are covered here too: they're the only write path for
// the optional steps, and their guarantees (own-columns-only, monotonic step, no row creation)
// are what the continuation-token design leans on.
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

const rows = () => db.select().from(waitlist);

beforeAll(async () => {
	// Mirror the schema's waitlist table + its case-insensitive unique index (the perf indexes are
	// irrelevant to these correctness tests).
	await client.execute(
		`CREATE TABLE waitlist (
			id text PRIMARY KEY NOT NULL,
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
			invited_at integer, invited_by text, activated_at integer,
			ip_hash text, user_agent text,
			created_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
			updated_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
		)`
	);
	await client.execute('CREATE UNIQUE INDEX waitlist_email_idx ON waitlist (lower(email))');
});

beforeEach(async () => {
	await client.execute('DELETE FROM waitlist');
});

afterAll(() => client.close());

describe('upsertWaitlist', () => {
	it('reports isNew=true and stores the row on a first signup', async () => {
		const r = await upsertWaitlist(db, { ...base, name: 'Ada' }, 'hash1', 'ua');
		expect(r.isNew).toBe(true);
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].email).toBe('ada@example.com');
		expect(all[0].name).toBe('Ada');
	});

	it('reports isNew=false on a re-signup and keeps ONE row, case-insensitively', async () => {
		await upsertWaitlist(db, { ...base, name: 'Ada' }, 'h', null);
		// same address, different case — the lower(email) unique index must dedupe it
		const r = await upsertWaitlist(
			db,
			{ ...base, email: 'ADA@example.com', company: 'Acme' },
			'h',
			null
		);
		expect(r.isNew).toBe(false);
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].email).toBe('ada@example.com'); // stored lowercase
		expect(all[0].company).toBe('Acme'); // the mixed-case resubmit still ENRICHED the row
	});

	it('enriches FILL-FORWARD: fills null columns but never overwrites a stored value', async () => {
		await upsertWaitlist(
			db,
			{ ...base, name: 'Ada', company: 'Acme', interest: 'Robotics' },
			'h',
			null
		);
		// A resubmit fills a still-null column (role) but a value for an already-set one (interest)
		// must NOT overwrite it — step 1 is unauthenticated, so a stranger who knows the email can't
		// clobber stored data. name/company are blank here, so they survive under either policy.
		await upsertWaitlist(
			db,
			{ ...base, role: 'engineering', interest: 'Fleet logistics' },
			'h',
			null
		);
		const [row] = await rows();
		expect(row.name).toBe('Ada'); // preserved (blank on resubmit)
		expect(row.company).toBe('Acme'); // preserved
		expect(row.role).toBe('engineering'); // filled (was null)
		expect(row.interest).toBe('Robotics'); // NOT overwritten — fill-forward keeps the stored value
	});

	it('enrich cannot overwrite a stored identity value even when a new one is supplied', async () => {
		// The security property behind fillIfEmpty: required-name (DAR-60) means every submit carries a
		// name, but an anonymous resubmit for a known email must not replace the stored one — and it's
		// throttle-exempt (enrich adds no row), so overwrite would be an unbounded vandalism vector.
		await upsertWaitlist(db, { ...base, name: 'Ada Lovelace', company: 'Acme' }, 'h', null);
		const r = await upsertWaitlist(
			db,
			{ ...base, name: 'Mallory', company: 'Evil Corp', countryRegion: 'europe' },
			'other-ip',
			null
		);
		expect(r.isNew).toBe(false);
		const [row] = await rows();
		expect(row.name).toBe('Ada Lovelace'); // attacker-supplied name did NOT win
		expect(row.company).toBe('Acme'); // nor company
		expect(row.countryRegion).toBe('europe'); // but a previously-NULL field still fills forward
	});

	it('leaves created_at unchanged across an enrich (it is an UPDATE, not a new row)', async () => {
		await upsertWaitlist(db, base, 'h', null);
		const [before] = await rows();
		await upsertWaitlist(db, { ...base, name: 'Ada' }, 'h', null);
		const [after] = await rows();
		expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
	});

	it('returns the SAME row id for insert and enrich (the continuation token binds to it)', async () => {
		const first = await upsertWaitlist(db, base, 'h', null);
		const again = await upsertWaitlist(db, { ...base, email: 'ADA@example.com' }, 'h', null);
		expect(first.id).toBeTruthy();
		expect(again.id).toBe(first.id); // case-insensitive match still resolves to the one row
	});

	it('enriches (never loops) when the stored email is not byte-lowercase', async () => {
		// Simulate an out-of-band row whose stored email has uppercase bytes (import/console write —
		// the column has no lowercase constraint, only the functional unique index). A signup for the
		// lowercase form conflicts on lower(email); the enrich must match it via lower(email), NOT an
		// exact-equality key that would miss and spin forever (the recursion-DoS this guards against).
		await client.execute(
			`INSERT INTO waitlist (id, email, name) VALUES ('mixed-1', 'Ada@Example.com', 'Ada')`
		);
		const r = await upsertWaitlist(db, { ...base, company: 'Acme' }, 'h', null);
		expect(r.isNew).toBe(false);
		expect(r.id).toBe('mixed-1');
		const all = await rows();
		expect(all).toHaveLength(1); // no duplicate inserted
		expect(all[0].company).toBe('Acme'); // enriched in place
	});

	it('starts qualification_step at 1 and keeps consent monotonic + timestamped across enriches', async () => {
		// First submit WITHOUT consent — no grant, no timestamp.
		await upsertWaitlist(db, base, 'h', null);
		let [row] = await rows();
		expect(row.qualificationStep).toBe(1);
		expect(row.consentUpdates).toBe(false);
		expect(row.consentUpdatesAt).toBeNull();

		// Enrich WITH consent — grant recorded, timestamp stamped.
		await upsertWaitlist(db, { ...base, consentUpdates: true }, 'h', null);
		[row] = await rows();
		expect(row.consentUpdates).toBe(true);
		const grantedAt = row.consentUpdatesAt;
		expect(grantedAt).not.toBeNull();

		// An unchecked box on a later re-submit is "no new grant", NOT a revocation, and must not
		// move the first-grant timestamp.
		await upsertWaitlist(db, { ...base, consentUpdates: false }, 'h', null);
		[row] = await rows();
		expect(row.consentUpdates).toBe(true);
		expect(row.consentUpdatesAt?.getTime()).toBe(grantedAt?.getTime());
	});
});

describe('applyWaitlistStep', () => {
	const insert = async () => (await upsertWaitlist(db, { ...base, name: 'Ada' }, 'h', null)).id;

	it('writes ONLY its own step columns — identity fields stay untouched', async () => {
		const id = await insert();
		const { updated } = await applyWaitlistStep(db, id, {
			step: 2,
			role: 'engineering-leader',
			primaryApplication: 'ai-agents-llm-systems',
			evaluationTimeline: 'evaluating-now'
		});
		expect(updated).toBe(true);
		const [row] = await rows();
		expect(row.email).toBe('ada@example.com'); // identity untouched
		expect(row.name).toBe('Ada');
		expect(row.role).toBe('engineering-leader');
		expect(row.primaryApplication).toBe('ai-agents-llm-systems');
		expect(row.evaluationTimeline).toBe('evaluating-now');
		expect(row.qualificationStep).toBe(2);
	});

	it('round-trips the JSON multi-selects and applies keep-existing on a sparser resubmit', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: 3,
			currentApproach: 'manual-operation',
			economicImpact: '250k-1m',
			budgetRange: '25k-100k',
			adoptionEvidence: ['evaluation-pilot', 'third-party-review']
		});
		// A sparser step-3 resubmit (all null) must erase nothing.
		await applyWaitlistStep(db, id, {
			step: 3,
			currentApproach: null,
			economicImpact: null,
			budgetRange: null,
			adoptionEvidence: null
		});
		const [row] = await rows();
		expect(row.currentApproach).toBe('manual-operation');
		expect(row.adoptionEvidence).toEqual(['evaluation-pilot', 'third-party-review']);
		expect(row.qualificationStep).toBe(3);
	});

	it('4a: boolean writes contact_permission absolutely, null keep-existings it, step never rewinds', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'yes-within-6-months',
			deploymentScale: 'Two quadrotor cells, ~40 units',
			contactPermission: true, // a granted answer
			contactMethod: 'email',
			phone: null
		});
		let [row] = await rows();
		expect(row.qualificationStep).toBe(4);
		expect(row.contactPermission).toBe(true);

		// Revisiting an EARLIER step must not rewind the high-water mark…
		await applyWaitlistStep(db, id, {
			step: 2,
			role: null,
			primaryApplication: null,
			evaluationTimeline: 'within-3-months'
		});
		// …and a later 4a where the question WASN'T shown (validator emits contactPermission=null)
		// must PRESERVE the standing grant — the key anti-clobber property.
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: null,
			deploymentScale: null,
			contactPermission: null,
			contactMethod: null,
			phone: null
		});
		[row] = await rows();
		expect(row.qualificationStep).toBe(4);
		expect(row.evaluationTimeline).toBe('within-3-months');
		expect(row.contactPermission).toBe(true); // NOT revoked by a not-shown submit
		expect(row.pilotInterest).toBe('yes-within-6-months'); // keep-existing survived the resubmit

		// An explicit decline (false — validator saw a positive pilot + unchecked box) DOES stick.
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'possibly-contact-me',
			deploymentScale: null,
			contactPermission: false,
			contactMethod: null,
			phone: null
		});
		[row] = await rows();
		expect(row.contactPermission).toBe(false);
	});

	it('stores step-4b research preferences', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: '4b',
			researchPreferences: ['technical-reports', 'open-source-releases']
		});
		const [row] = await rows();
		expect(row.researchPreferences).toEqual(['technical-reports', 'open-source-releases']);
		expect(row.qualificationStep).toBe(4);
	});

	it('reports updated=false for an unknown id and NEVER creates a row (decoy-token path)', async () => {
		const { updated } = await applyWaitlistStep(db, crypto.randomUUID(), {
			step: 2,
			role: null,
			primaryApplication: null,
			evaluationTimeline: null
		});
		expect(updated).toBe(false);
		expect(await rows()).toHaveLength(0);
	});
});

// DAR-68 — the per-row step-write budget. These steps are unauthenticated writes authorized only by
// the continuation token, which the anti-enumeration success shape hands to any submitter of a known
// address, so the bound has to hold against a holder who is deliberately hostile.
describe('applyWaitlistStep step-write budget', () => {
	const insert = async () => (await upsertWaitlist(db, { ...base, name: 'Ada' }, 'h', null)).id;

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
			sql: 'UPDATE waitlist SET step_write_window_at = ? WHERE id = ?',
			args: [Date.now() - WAITLIST_STEP_WRITE_WINDOW_MS - 60_000, id]
		});

	it('opens a window on the first step write and spends one unit per write', async () => {
		const id = await insert();
		await step2(id);
		const [first] = await rows();
		expect(first.stepWriteCount).toBe(1);
		expect(first.stepWriteWindowAt).toBeInstanceOf(Date);

		// Move the window start to a known moment still INSIDE the window before the second write.
		// Without this the next assertion is intermittently blind: two consecutive writes can land in
		// the same millisecond, and then "the start didn't move" is true of a SLIDING window too —
		// measured, it misses the sliding mutation about one run in three. Pinning it half a window
		// back makes the two behaviours differ by half an hour.
		const pinned = Date.now() - WAITLIST_STEP_WRITE_WINDOW_MS / 2;
		await client.execute({
			sql: 'UPDATE waitlist SET step_write_window_at = ? WHERE id = ?',
			args: [pinned, id]
		});

		await step2(id);
		const [second] = await rows();
		expect(second.stepWriteCount).toBe(2);
		// Fixed window, not sliding: a write inside a live window must not push its start forward, or
		// a steady drip would hold the window open indefinitely and the cap would never reset.
		expect(second.stepWriteWindowAt?.getTime()).toBe(pinned);
	});

	it('refuses the write past the cap, and refuses it the SAME way a missing row is refused', async () => {
		const id = await insert();
		for (let i = 0; i < WAITLIST_STEP_WRITE_MAX; i++) expect((await step2(id)).updated).toBe(true);

		// Over budget. `updated: false` is the identical answer applyWaitlistStep gives for an id that
		// matches no row (the decoy-token path above), which is what keeps the throttle from being a
		// token-validity oracle: the caller cannot tell the two apart, and returns the same success.
		const over = await step2(id, 'researcher');
		expect(over.updated).toBe(false);

		const [row] = await rows();
		expect(row.role).toBe('engineering-leader'); // the refused answer was not applied
		expect(row.stepWriteCount).toBe(WAITLIST_STEP_WRITE_MAX); // …and refusing did not spend budget either
	});

	it('leaves the row byte-identical when it refuses — including the window start', async () => {
		const id = await insert();
		for (let i = 0; i < WAITLIST_STEP_WRITE_MAX; i++) await step2(id);
		const [before] = await rows();

		await step2(id, 'researcher');
		const [after] = await rows();
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
		const [row] = await rows();
		expect(row.role).toBe('researcher');
		expect(row.stepWriteCount).toBe(1); // a fresh window starts the count over, it does not resume
	});

	it('treats a pre-DAR-68 row (null counters) as having a full budget', async () => {
		const id = await insert();
		await client.execute({
			sql: 'UPDATE waitlist SET step_write_count = NULL, step_write_window_at = NULL WHERE id = ?',
			args: [id]
		});
		const { updated } = await step2(id);
		expect(updated).toBe(true);
		const [row] = await rows();
		expect(row.stepWriteCount).toBe(1);
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
