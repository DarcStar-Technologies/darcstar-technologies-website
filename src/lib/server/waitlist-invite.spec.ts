import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import { findAccountByEmail, markWaitlistActivated, markWaitlistInvited } from './waitlist-invite';

// The invite state machine against a real in-memory libsql, because what's worth testing here lives
// in the WHERE clauses rather than in the TypeScript: `markWaitlistActivated` is a conditional UPDATE
// whose two predicates are the difference between "records an onboarding" and "quietly rewrites
// history for anyone who resets a password". A mock would assert the query I wrote, not what SQLite
// does with it.
const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema }) as unknown as Db;

const OWNER_ID = 'owner-user-id';
const NOW_DEFAULT = "(cast(unixepoch('subsecond') * 1000 as integer))";

beforeAll(async () => {
	// Only the columns these helpers touch — this is a test of the predicates, not of the schema
	// (schema drift is caught by the drizzle CI gate).
	await client.execute(
		`CREATE TABLE waitlist (
			id text PRIMARY KEY NOT NULL,
			email text NOT NULL,
			invited_at integer,
			invited_by text,
			activated_at integer,
			updated_at integer DEFAULT ${NOW_DEFAULT} NOT NULL
		)`
	);
	await client.execute(
		`CREATE TABLE user (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			email text NOT NULL,
			email_verified integer DEFAULT 0 NOT NULL,
			created_at integer DEFAULT ${NOW_DEFAULT} NOT NULL,
			updated_at integer DEFAULT ${NOW_DEFAULT} NOT NULL,
			role text,
			banned integer DEFAULT 0
		)`
	);
});

afterAll(() => client.close());

beforeEach(async () => {
	await client.execute('DELETE FROM waitlist');
	await client.execute('DELETE FROM user');
});

/** Seed a waitlist row. Timestamps are epoch ms, matching the `timestamp_ms` column mode. */
async function seedLead(
	id: string,
	email: string,
	{
		invitedAt = null,
		activatedAt = null
	}: { invitedAt?: number | null; activatedAt?: number | null } = {}
) {
	await client.execute({
		sql: 'INSERT INTO waitlist (id, email, invited_at, activated_at, updated_at) VALUES (?, ?, ?, ?, ?)',
		args: [id, email, invitedAt, activatedAt, 1_000_000]
	});
}

async function seedAccount(id: string, email: string, role: string | null, banned = 0) {
	await client.execute({
		sql: 'INSERT INTO user (id, name, email, role, banned) VALUES (?, ?, ?, ?, ?)',
		args: [id, 'Seeded', email, role, banned]
	});
}

const readLead = async (id: string) => {
	const res = await client.execute({
		sql: 'SELECT invited_at, invited_by, activated_at, updated_at FROM waitlist WHERE id = ?',
		args: [id]
	});
	return res.rows[0] as unknown as {
		invited_at: number | null;
		invited_by: string | null;
		activated_at: number | null;
		updated_at: number;
	};
};

describe('findAccountByEmail', () => {
	it('returns null when the address has no account', async () => {
		expect(await findAccountByEmail(db, 'nobody@example.com', undefined)).toBeNull();
	});

	// The waitlist stores whatever the visitor typed; Better Auth lowercases account emails. Without a
	// case-insensitive match, inviting `Ada@Example.com` would create a SECOND account for an address
	// that already has one — and better-auth would reject it, so the operator would just see a failure
	// they can't act on.
	it('matches case-insensitively', async () => {
		await seedAccount('u1', 'ada@example.com', 'user');
		const found = await findAccountByEmail(db, '  Ada@Example.COM ', undefined);
		expect(found?.id).toBe('u1');
	});

	it('reports an ordinary end-user account as not staff', async () => {
		await seedAccount('u1', 'lead@example.com', 'user');
		expect(await findAccountByEmail(db, 'lead@example.com', undefined)).toEqual({
			id: 'u1',
			role: 'user',
			isStaff: false,
			banned: false
		});
	});

	// The invite refuses a disabled account, because setting a password does not lift a ban — the
	// prospect would follow a live link to a sign-in they still can't pass.
	it('reports a roster-disabled account as banned', async () => {
		await seedAccount('u1', 'disabled@example.com', 'user', 1);
		expect((await findAccountByEmail(db, 'disabled@example.com', undefined))?.banned).toBe(true);
	});

	// `banned` is nullable — the column arrived with the admin plugin, so rows created before it hold
	// null. Null must read as "not banned", or every legacy account becomes uninvitable.
	it('reads a null banned column as not banned', async () => {
		await seedAccount('u1', 'legacy@example.com', null, null as unknown as number);
		expect((await findAccountByEmail(db, 'legacy@example.com', undefined))?.banned).toBe(false);
	});

	// The staff flag is what stops the invite button from mailing a password-reset link at a colleague.
	it('flags admin and operator accounts as staff', async () => {
		await seedAccount('u-admin', 'boss@darcstar.tech', 'admin');
		await seedAccount('u-op', 'op@darcstar.tech', 'operator');
		expect((await findAccountByEmail(db, 'boss@darcstar.tech', undefined))?.isStaff).toBe(true);
		expect((await findAccountByEmail(db, 'op@darcstar.tech', undefined))?.isStaff).toBe(true);
	});

	// The owner bootstrap is an env allowlist that overrides the role column entirely (admin-access.ts),
	// so a role-less owner is still staff. Missing this would leave the one account that can never be
	// locked out as the one account the invite button is happy to mail a reset link to.
	it('honours the ADMIN_USER_IDS owner allowlist over a null role', async () => {
		await seedAccount(OWNER_ID, 'owner@darcstar.tech', null);
		expect((await findAccountByEmail(db, 'owner@darcstar.tech', undefined))?.isStaff).toBe(false);
		expect((await findAccountByEmail(db, 'owner@darcstar.tech', OWNER_ID))?.isStaff).toBe(true);
	});
});

describe('markWaitlistInvited', () => {
	it('stamps who invited them and when', async () => {
		await seedLead('w1', 'lead@example.com');
		await markWaitlistInvited(db, 'w1', 'staff-1');

		const row = await readLead('w1');
		expect(row.invited_by).toBe('staff-1');
		expect(row.invited_at).toBeGreaterThan(0);
	});

	// A resend deliberately MOVES the timestamp: the triage question is "how long ago did I email
	// them", and a first-contact date frozen weeks back answers it wrongly. The durable history is the
	// per-invite Workers Logs line, not this column.
	it('overwrites the timestamp on a resend', async () => {
		await seedLead('w1', 'lead@example.com', { invitedAt: 1_000 });
		await markWaitlistInvited(db, 'w1', 'staff-2');

		const row = await readLead('w1');
		expect(row.invited_at).toBeGreaterThan(1_000);
		expect(row.invited_by).toBe('staff-2');
	});

	// Same rule as `markWaitlistActivated` below: `updated_at` is the VISITOR's edit timestamp (the step
	// writes bump it), and an invite is our action, not theirs. These two helpers disagreeing about it
	// would make "last updated" mean one thing for invited rows and another for activated ones.
	it('leaves updated_at alone', async () => {
		await seedLead('w1', 'lead@example.com');
		await markWaitlistInvited(db, 'w1', 'staff-1');
		expect((await readLead('w1')).updated_at).toBe(1_000_000);
	});
});

describe('markWaitlistActivated', () => {
	it('stamps an invited row that has not activated yet', async () => {
		await seedLead('w1', 'lead@example.com', { invitedAt: 1_000 });
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(1);
		expect((await readLead('w1')).activated_at).toBeGreaterThan(0);
	});

	// THE GUARD THAT MATTERS. This runs from auth.ts's `onPasswordReset`, which fires for EVERY reset
	// on the site. Someone who is on the waitlist but was never invited, doing an ordinary self-service
	// reset on an account they got some other way, must not have their row claim an onboarding that
	// never happened.
	it('refuses to stamp a row that was never invited', async () => {
		await seedLead('w1', 'lead@example.com');
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(0);
		expect((await readLead('w1')).activated_at).toBeNull();
	});

	// Monotonic: the column means "when they first set a password", so a routine reset years later must
	// not rewrite it into "last password change".
	it('never re-stamps an already-activated row', async () => {
		await seedLead('w1', 'lead@example.com', { invitedAt: 1_000, activatedAt: 2_000 });
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(0);
		expect((await readLead('w1')).activated_at).toBe(2_000);
	});

	it('matches the address case-insensitively', async () => {
		await seedLead('w1', 'Ada@Example.com', { invitedAt: 1_000 });
		expect(await markWaitlistActivated(db, 'ada@example.com')).toBe(1);
	});

	it('is a no-op for an address that is not on the list, and for an empty one', async () => {
		await seedLead('w1', 'lead@example.com', { invitedAt: 1_000 });
		expect(await markWaitlistActivated(db, 'stranger@example.com')).toBe(0);
		expect(await markWaitlistActivated(db, '   ')).toBe(0);
		expect((await readLead('w1')).activated_at).toBeNull();
	});

	// `updated_at` tracks the VISITOR's own edits to their qualification answers. This stamp is ours,
	// and moving their timestamp would make the triage view report activity they didn't perform.
	it('leaves updated_at alone', async () => {
		await seedLead('w1', 'lead@example.com', { invitedAt: 1_000 });
		await markWaitlistActivated(db, 'lead@example.com');
		expect((await readLead('w1')).updated_at).toBe(1_000_000);
	});
});
