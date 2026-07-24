import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import { waitlist } from './db/schema';
import { applyWaitlistStep, upsertWaitlist } from './waitlist-store';
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
			primary_application text, evaluation_timeline text,
			current_approach text, economic_impact text, budget_range text, adoption_evidence text,
			pilot_interest text, deployment_scale text, contact_permission integer, contact_method text,
			research_preferences text,
			qualification_step integer,
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

	it('enriches: fills newly-provided fields, never erases existing ones', async () => {
		await upsertWaitlist(
			db,
			{ ...base, name: 'Ada', company: 'Acme', interest: 'Robotics' },
			'h',
			null
		);
		// resubmit adds a role + a new interest, leaves name/company blank → they must survive
		await upsertWaitlist(
			db,
			{ ...base, role: 'engineering', interest: 'Fleet logistics' },
			'h',
			null
		);
		const [row] = await rows();
		expect(row.name).toBe('Ada'); // preserved (blank on resubmit)
		expect(row.company).toBe('Acme'); // preserved
		expect(row.role).toBe('engineering'); // filled
		expect(row.interest).toBe('Fleet logistics'); // updated (provided value wins)
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

	it('starts qualification_step at 1 and keeps consent monotonic across enriches', async () => {
		await upsertWaitlist(db, { ...base, consentUpdates: true }, 'h', null);
		let [row] = await rows();
		expect(row.qualificationStep).toBe(1);
		expect(row.consentUpdates).toBe(true);

		// An unchecked box on a re-submit is "no new grant", NOT a revocation.
		await upsertWaitlist(db, { ...base, consentUpdates: false }, 'h', null);
		[row] = await rows();
		expect(row.consentUpdates).toBe(true);
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

	it('never rewinds qualification_step, and 4a records the submitted contact-permission state', async () => {
		const id = await insert();
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: 'yes-within-6-months',
			deploymentScale: 'Two quadrotor cells, ~40 units',
			contactPermission: true,
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
		// …and re-answering 4a with the box unchecked IS a decline (this one is not keep-existing).
		await applyWaitlistStep(db, id, {
			step: '4a',
			pilotInterest: null,
			deploymentScale: null,
			contactPermission: false,
			contactMethod: null,
			phone: null
		});
		[row] = await rows();
		expect(row.qualificationStep).toBe(4);
		expect(row.evaluationTimeline).toBe('within-3-months');
		expect(row.contactPermission).toBe(false);
		expect(row.pilotInterest).toBe('yes-within-6-months'); // keep-existing survived the resubmit
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
