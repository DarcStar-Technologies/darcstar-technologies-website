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

// Login audit — one row per sign-in ATTEMPT (success and failure). Rows are written by the Better
// Auth `hooks.after` middleware (src/lib/server/auth-audit.ts, persisted via login-audit-store.ts),
// which is the single chokepoint for every sign-in — the `/login` form action AND a direct
// `POST /api/auth/sign-in/email`. Rate-limit 429s are the one case the endpoint hook can't see (the
// router rejects them before dispatch), so the login action records those itself.
//
// This is an APP-owned table (like `contact_submission`), NOT a Better Auth plugin table — so it is
// intentionally NOT in auth.schema.ts and is NOT mirrored in auth-cli.ts.
//
// `ipAddress` is the RAW client IP (unlike `contact_submission.ip_hash`): the point is to track a
// credential-stuffing source, and it's consistent with Better Auth's own `session.ip_address`.
// `reason` is a coarse machine string on failure (`invalid_credentials` / `banned` / `rate_limited` /
// a raw Better Auth error code), null on success. `userId` is resolved only on a successful sign-in.
export const loginAudit = sqliteTable(
	'login_audit',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		email: text('email'),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		success: integer('success', { mode: 'boolean' }).notNull(),
		reason: text('reason'),
		status: integer('status'),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	},
	(table) => [
		index('login_audit_created_idx').on(table.createdAt),
		index('login_audit_email_created_idx').on(table.email, table.createdAt),
		index('login_audit_ip_created_idx').on(table.ipAddress, table.createdAt),
		index('login_audit_user_idx').on(table.userId)
	]
);

export * from './auth.schema';
