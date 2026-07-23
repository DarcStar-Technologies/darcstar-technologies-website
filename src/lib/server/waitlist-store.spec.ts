import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import { waitlist } from './db/schema';
import { upsertWaitlist } from './waitlist-store';
import type { CleanedWaitlist } from './waitlist';

// Real DB integration test — the insert-or-enrich + `isNew` gate is the security-critical logic
// (gates the emails; the pure specs can't reach it), so exercise it against an in-memory libsql.
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
	phone: null
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
});
