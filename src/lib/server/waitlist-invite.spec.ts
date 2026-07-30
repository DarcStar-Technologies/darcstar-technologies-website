import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';
import type { Db } from './db';
import {
	findAccountByEmail,
	findWaitlistInviteTarget,
	markWaitlistActivated,
	markWaitlistInvited,
	markWaitlistReviewed
} from './waitlist-invite';

// The invite state machine against a real in-memory libsql, because what's worth testing here lives
// in the WHERE clauses rather than in the TypeScript: `markWaitlistActivated` is a conditional UPDATE
// whose two predicates are the difference between "records an onboarding" and "quietly rewrites
// history for anyone who resets a password". A mock would assert the query I wrote, not what SQLite
// does with it.
//
// Since DAR-88 these helpers address the LEAD, and the submissions sit beside it as an append-only
// log — so several tests below check that our own stamps never reach into what people submitted.
const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema }) as unknown as Db;

const OWNER_ID = 'owner-user-id';
const NOW_DEFAULT = "(cast(unixepoch('subsecond') * 1000 as integer))";

beforeAll(async () => {
	// Only the columns these helpers touch — this is a test of the predicates, not of the schema
	// (schema drift is caught by the drizzle CI gate).
	await client.execute(
		`CREATE TABLE waitlist_lead (
			id text PRIMARY KEY NOT NULL,
			email text NOT NULL,
			invited_at integer,
			invited_by text,
			activated_at integer,
			do_not_contact_at integer,
			do_not_contact_by text,
			reviewed_at integer,
			reviewed_by text,
			created_at integer DEFAULT ${NOW_DEFAULT} NOT NULL
		)`
	);
	await client.execute(
		`CREATE TABLE waitlist_submission (
			id text PRIMARY KEY NOT NULL,
			lead_id text NOT NULL,
			email text NOT NULL,
			name text,
			created_at integer DEFAULT ${NOW_DEFAULT} NOT NULL,
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
	await client.execute('DELETE FROM waitlist_submission');
	await client.execute('DELETE FROM waitlist_lead');
	await client.execute('DELETE FROM user');
});

/** Seed a lead. Timestamps are epoch ms, matching the `timestamp_ms` column mode. */
async function seedLead(
	id: string,
	email: string,
	{
		invitedAt = null,
		activatedAt = null,
		reviewedAt = null
	}: { invitedAt?: number | null; activatedAt?: number | null; reviewedAt?: number | null } = {}
) {
	await client.execute({
		sql: 'INSERT INTO waitlist_lead (id, email, invited_at, activated_at, reviewed_at) VALUES (?, ?, ?, ?, ?)',
		args: [id, email, invitedAt, activatedAt, reviewedAt]
	});
}

/** Seed one submission under a lead, at an explicit moment so ordering is deterministic. */
async function seedSubmission(
	id: string,
	leadId: string,
	email: string,
	name: string | null,
	createdAt: number
) {
	await client.execute({
		sql: 'INSERT INTO waitlist_submission (id, lead_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		args: [id, leadId, email, name, createdAt, 1_000_000]
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
		sql: 'SELECT invited_at, invited_by, activated_at, reviewed_at, reviewed_by FROM waitlist_lead WHERE id = ?',
		args: [id]
	});
	return res.rows[0] as unknown as {
		invited_at: number | null;
		invited_by: string | null;
		activated_at: number | null;
		reviewed_at: number | null;
		reviewed_by: string | null;
	};
};

const readSubmissions = async () => {
	const res = await client.execute('SELECT id, updated_at FROM waitlist_submission ORDER BY id');
	return res.rows as unknown as { id: string; updated_at: number }[];
};

describe('findAccountByEmail', () => {
	it('returns null when the address has no account', async () => {
		expect(await findAccountByEmail(db, 'nobody@example.com', undefined)).toBeNull();
	});

	// Better Auth lowercases account emails; a legacy lead may hold mixed case. Without a
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

describe('findWaitlistInviteTarget', () => {
	it('takes the address from the lead and the name from the EARLIEST submission that gave one', async () => {
		// THE SECURITY-RELEVANT ORDERING. Under append-only anyone can add a submission for a known
		// address, so a newest-name rule would let a stranger choose how we greet the real person in an
		// email we send to their inbox. Oldest-non-null reproduces the pre-DAR-88 behaviour exactly
		// (step 1's enrich was fill-forward on `name`, so the first one given always won).
		await seedLead('l1', 'ada@example.com');
		await seedSubmission('s1', 'l1', 'ada@example.com', 'Ada Lovelace', 1_000);
		await seedSubmission('s2', 'l1', 'ada@example.com', 'Mallory', 9_000);

		expect(await findWaitlistInviteTarget(db, 'l1')).toEqual({
			email: 'ada@example.com',
			name: 'Ada Lovelace',
			// DAR-191 rides along on this lookup so the invite can refuse without a second query.
			// Kept an EXACT-shape assertion rather than loosened to `toMatchObject`: what this function
			// hands the invite mailer is worth being able to read here in full.
			doNotContactAt: null
		});
	});

	it('skips submissions with no name rather than reporting null', async () => {
		// v1 rows have no name (it became required at DAR-60), so "earliest" must mean "earliest that
		// actually supplied one" or a legacy first submission would blank the greeting forever.
		await seedLead('l1', 'ada@example.com');
		await seedSubmission('s1', 'l1', 'ada@example.com', null, 1_000);
		await seedSubmission('s2', 'l1', 'ada@example.com', 'Ada', 2_000);

		expect((await findWaitlistInviteTarget(db, 'l1'))?.name).toBe('Ada');
	});

	it('returns the lead with a null name when no submission ever gave one', async () => {
		await seedLead('l1', 'ada@example.com');
		await seedSubmission('s1', 'l1', 'ada@example.com', null, 1_000);
		expect(await findWaitlistInviteTarget(db, 'l1')).toEqual({
			email: 'ada@example.com',
			name: null,
			doNotContactAt: null
		});
	});

	// Deleted from under the operator between rendering the table and clicking Invite.
	it('returns null for a lead that no longer exists', async () => {
		expect(await findWaitlistInviteTarget(db, 'gone')).toBeNull();
	});

	it('ignores submissions belonging to a different lead', async () => {
		await seedLead('l1', 'ada@example.com');
		await seedLead('l2', 'grace@example.com');
		await seedSubmission('s1', 'l2', 'grace@example.com', 'Grace', 1_000);
		await seedSubmission('s2', 'l1', 'ada@example.com', 'Ada', 2_000);
		expect((await findWaitlistInviteTarget(db, 'l1'))?.name).toBe('Ada');
	});
});

describe('markWaitlistInvited', () => {
	it('stamps who invited them and when', async () => {
		await seedLead('l1', 'lead@example.com');
		await markWaitlistInvited(db, 'l1', 'staff-1');

		const row = await readLead('l1');
		expect(row.invited_by).toBe('staff-1');
		expect(row.invited_at).toBeGreaterThan(0);
	});

	// A resend deliberately MOVES the timestamp: the triage question is "how long ago did I email
	// them", and a first-contact date frozen weeks back answers it wrongly. The durable history is the
	// per-invite Workers Logs line, not this column.
	it('overwrites the timestamp on a resend', async () => {
		await seedLead('l1', 'lead@example.com', { invitedAt: 1_000 });
		await markWaitlistInvited(db, 'l1', 'staff-2');

		const row = await readLead('l1');
		expect(row.invited_at).toBeGreaterThan(1_000);
		expect(row.invited_by).toBe('staff-2');
	});

	// Our stamps must never touch the submissions. Before DAR-88 this was a discipline (both helpers
	// carefully avoided bumping `updated_at`); now it is structural, since the column they write isn't
	// on the same table — and this pins that the tables really did come apart.
	it('leaves every submission untouched', async () => {
		await seedLead('l1', 'lead@example.com');
		await seedSubmission('s1', 'l1', 'lead@example.com', 'Ada', 1_000);
		const before = await readSubmissions();
		await markWaitlistInvited(db, 'l1', 'staff-1');
		expect(await readSubmissions()).toEqual(before);
	});
});

describe('markWaitlistActivated', () => {
	it('stamps an invited lead that has not activated yet', async () => {
		await seedLead('l1', 'lead@example.com', { invitedAt: 1_000 });
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(1);
		expect((await readLead('l1')).activated_at).toBeGreaterThan(0);
	});

	// THE GUARD THAT MATTERS. This runs from auth.ts's `onPasswordReset`, which fires for EVERY reset
	// on the site. Someone who is on the waitlist but was never invited, doing an ordinary self-service
	// reset on an account they got some other way, must not have their row claim an onboarding that
	// never happened.
	it('refuses to stamp a lead that was never invited', async () => {
		await seedLead('l1', 'lead@example.com');
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(0);
		expect((await readLead('l1')).activated_at).toBeNull();
	});

	// Monotonic: the column means "when they first set a password", so a routine reset years later must
	// not rewrite it into "last password change".
	it('never re-stamps an already-activated lead', async () => {
		await seedLead('l1', 'lead@example.com', { invitedAt: 1_000, activatedAt: 2_000 });
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(0);
		expect((await readLead('l1')).activated_at).toBe(2_000);
	});

	it('matches the address case-insensitively', async () => {
		await seedLead('l1', 'Ada@Example.com', { invitedAt: 1_000 });
		expect(await markWaitlistActivated(db, 'ada@example.com')).toBe(1);
	});

	it('is a no-op for an address that is not on the list, and for an empty one', async () => {
		await seedLead('l1', 'lead@example.com', { invitedAt: 1_000 });
		expect(await markWaitlistActivated(db, 'stranger@example.com')).toBe(0);
		expect(await markWaitlistActivated(db, '   ')).toBe(0);
		expect((await readLead('l1')).activated_at).toBeNull();
	});

	// Keyed by email, which is all the auth hook knows — and it stays a SINGLE-row update because the
	// uniqueness moved to the lead. Run against the submissions it would stamp every row this address
	// ever created; the count this returns (which the caller logs) would then be a submission count
	// masquerading as an activation count.
	it('stamps exactly one row however many submissions the address has', async () => {
		await seedLead('l1', 'lead@example.com', { invitedAt: 1_000 });
		await seedSubmission('s1', 'l1', 'lead@example.com', 'Ada', 1_000);
		await seedSubmission('s2', 'l1', 'lead@example.com', 'Ada', 2_000);
		await seedSubmission('s3', 'l1', 'lead@example.com', 'Ada', 3_000);
		expect(await markWaitlistActivated(db, 'lead@example.com')).toBe(1);
	});

	it('leaves every submission untouched', async () => {
		await seedLead('l1', 'lead@example.com', { invitedAt: 1_000 });
		await seedSubmission('s1', 'l1', 'lead@example.com', 'Ada', 1_000);
		const before = await readSubmissions();
		await markWaitlistActivated(db, 'lead@example.com');
		expect(await readSubmissions()).toEqual(before);
	});
});

describe('markWaitlistReviewed', () => {
	it('stamps who reviewed the lead and when', async () => {
		await seedLead('l1', 'lead@example.com');
		await markWaitlistReviewed(db, 'l1', 'staff-1');
		const row = await readLead('l1');
		expect(row.reviewed_by).toBe('staff-1');
		expect(row.reviewed_at).toBeGreaterThan(0);
	});

	// Not monotonic, unlike `activated_at`: the useful reading is "last looked at". A lead that gains a
	// new submission after being reviewed genuinely does need looking at again, and the page derives
	// exactly that by comparing the newest submission against this stamp.
	it('refreshes the stamp on a re-review', async () => {
		await seedLead('l1', 'lead@example.com', { reviewedAt: 1_000 });
		await markWaitlistReviewed(db, 'l1', 'staff-2');
		const row = await readLead('l1');
		expect(row.reviewed_at).toBeGreaterThan(1_000);
		expect(row.reviewed_by).toBe('staff-2');
	});

	// A review is our judgement about what people submitted, never an edit of it.
	it('leaves every submission untouched', async () => {
		await seedLead('l1', 'lead@example.com');
		await seedSubmission('s1', 'l1', 'lead@example.com', 'Ada', 1_000);
		const before = await readSubmissions();
		await markWaitlistReviewed(db, 'l1', 'staff-1');
		expect(await readSubmissions()).toEqual(before);
	});
});
