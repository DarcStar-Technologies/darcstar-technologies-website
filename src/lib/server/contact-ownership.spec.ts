import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { contactSubmission } from './db/schema';
import { linkSubmissionsToUser } from './contact-ownership';

// Spin up a throwaway in-memory SQLite (real libsql, so the helper's `lower()` SQL runs for real)
// with just the contact_submission table the helper touches. Column defs mirror schema.ts so a
// drizzle insert (which emits the id + created_at defaults) matches the table.
async function makeDb() {
	const client = createClient({ url: ':memory:' });
	await client.execute(`CREATE TABLE contact_submission (
		id text PRIMARY KEY NOT NULL,
		name text NOT NULL,
		email text NOT NULL,
		company text,
		interest text,
		message text NOT NULL,
		ip_hash text,
		user_agent text,
		user_id text,
		created_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
	)`);
	// The helper is typed against the web libsql client (getDb); the node client used here is the
	// same LibSQLDatabase shape, but cast through the parameter type to keep the spec honest.
	return drizzle(client, { schema }) as unknown as Parameters<typeof linkSubmissionsToUser>[0];
}

describe('linkSubmissionsToUser', () => {
	it('claims every matching row, case-insensitively, and returns the count', async () => {
		const db = await makeDb();
		await db.insert(contactSubmission).values([
			{ name: 'A', email: 'ada@example.com', message: 'x' },
			{ name: 'B', email: 'ADA@Example.com', message: 'y' },
			{ name: 'C', email: 'other@example.com', message: 'z' }
		]);

		const linked = await linkSubmissionsToUser(db, 'user-1', '  Ada@example.com ');
		expect(linked).toBe(2);

		const mine = await db
			.select({ email: contactSubmission.email })
			.from(contactSubmission)
			.where(eq(contactSubmission.userId, 'user-1'));
		expect(mine.map((r) => r.email).sort()).toEqual(['ADA@Example.com', 'ada@example.com']);
	});

	it('never re-assigns a submission already linked to another account', async () => {
		const db = await makeDb();
		await db.insert(contactSubmission).values([
			{ name: 'A', email: 'ada@example.com', message: 'x', userId: 'someone-else' },
			{ name: 'B', email: 'ada@example.com', message: 'y' }
		]);

		const linked = await linkSubmissionsToUser(db, 'user-1', 'ada@example.com');
		expect(linked).toBe(1); // only the unowned row

		const owners = (await db.select({ userId: contactSubmission.userId }).from(contactSubmission))
			.map((r) => r.userId)
			.sort();
		expect(owners).toEqual(['someone-else', 'user-1']);
	});

	it('is a no-op for a blank email', async () => {
		const db = await makeDb();
		await db
			.insert(contactSubmission)
			.values({ name: 'A', email: 'ada@example.com', message: 'x' });
		expect(await linkSubmissionsToUser(db, 'user-1', '   ')).toBe(0);
	});
});
