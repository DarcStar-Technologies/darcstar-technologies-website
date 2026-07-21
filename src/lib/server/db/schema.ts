import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

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
//
// `userId` links a submission to an account (#96 end-user portal). It's NULLABLE:
// anonymous leads (the common case) and every pre-#96 row stay null. It's set when
// a signed-in visitor submits, when an admin creates an account with a matching
// email, or when a self-registered user verifies that email (see contact-ownership.ts).
// `onDelete: 'set null'` preserves the lead as an anonymous row if the account is
// later deleted. The `user_id` index backs the `/account` "your messages" query.
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
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	},
	(table) => [
		index('contact_ip_created_idx').on(table.ipHash, table.createdAt),
		index('contact_user_idx').on(table.userId)
	]
);

export * from './auth.schema';
