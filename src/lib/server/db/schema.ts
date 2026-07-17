import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

// Contact-form submissions (issue #11). Rows are written by the `submitContact`
// remote function (src/lib/contact.remote.ts) after honeypot + validation +
// throttle checks. `ipHash` is a truncated SHA-256 of the client IP (never the
// raw address) used only for the abuse throttle; the (ip_hash, created_at) index
// backs that lookback query.
export const contactSubmission = sqliteTable(
	'contact_submission',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		email: text('email').notNull(),
		company: text('company'),
		interest: text('interest'),
		message: text('message').notNull(),
		ipHash: text('ip_hash'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	},
	(table) => [index('contact_ip_created_idx').on(table.ipHash, table.createdAt)]
);

export * from './auth.schema';
