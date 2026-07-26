import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
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

// Waitlist signups (issue-tracked feature) — early-access lead capture, a lighter-touch sibling of
// `contact_submission`. Written by the `joinWaitlist` remote function (src/lib/waitlist.remote.ts)
// after honeypot + validation + throttle, mirroring the contact flow (`ip_hash` is the same
// truncated SHA-256, never the raw IP; the (ip_hash, created_at) index backs the throttle lookback).
//
// Differences from `contact_submission`:
//   - `email` is UNIQUE, case-insensitively — the unique index is on `lower(email)`, so a
//     mixed-case duplicate can't slip in even if some future writer forgets to normalize (the
//     validator lowercases on write too, so stored values are already lowercase). A re-signup is an
//     insert-or-enrich (see waitlist-store.ts) rather than piling up duplicate leads. Hence
//     `updated_at`.
//   - Only `email` is required; every other field is optional lead enrichment (progressive
//     disclosure on the form). `role`/`company_size`/`hear_about` are validated slugs; `interest`
//     is deliberately FREE TEXT (a growing list, not an enum) and `phone` is free text. The
//     `interest` index backs the /waitlist datalist's frequency query (group by interest).
//   - No `user_id`: a waitlist is pre-account lead capture, so rows are not linked to accounts.
//   - The v2 progressive flow (DAR-59) adds the qualification columns below the v1 block. All are
//     nullable (steps 2–4 are optional and reached via a signed continuation token — see
//     waitlist-token.ts); slugs are validated against $lib/waitlist-qualification.ts; the two
//     multi-selects store JSON string arrays. `company_size`/`interest`/`hear_about` predate v2 and
//     stay for their historical data even after the v2 UI stops writing them. `role` is shared:
//     v1 slugs remain as history, new writes use the v2 set.
export const waitlist = sqliteTable(
	'waitlist',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		email: text('email').notNull(),
		name: text('name'),
		company: text('company'),
		role: text('role'),
		companySize: text('company_size'),
		interest: text('interest'),
		hearAbout: text('hear_about'),
		phone: text('phone'),
		// --- v2 step 1 (DAR-60) ---
		countryRegion: text('country_region'),
		// Marketing-updates opt-in. False for every pre-v2 row (nobody was asked); grants are
		// monotonic in the store (an unchecked re-submit never silently revokes) — revocation is a
		// deliberate future mechanism, not a form default. IMPORTANT: this is an UNVERIFIED claim —
		// the form is unauthenticated single-opt-in, so a third party can set it for any address. It
		// must NOT drive a real send without double-opt-in + unsubscribe (see waitlist-store.ts).
		consentUpdates: integer('consent_updates', { mode: 'boolean' }).default(false).notNull(),
		// When consent was FIRST granted (provenance for a compliance review). Null = never granted;
		// separate from updated_at, which later step writes clobber.
		consentUpdatesAt: integer('consent_updates_at', { mode: 'timestamp_ms' }),
		// --- v2 step 2 (DAR-61) ---
		primaryApplication: text('primary_application'),
		evaluationTimeline: text('evaluation_timeline'),
		// --- v2 step 3 (DAR-62) ---
		currentApproach: text('current_approach'),
		economicImpact: text('economic_impact'),
		budgetRange: text('budget_range'),
		adoptionEvidence: text('adoption_evidence', { mode: 'json' }).$type<string[]>(),
		// --- v2 step 4A (DAR-63) ---
		pilotInterest: text('pilot_interest'),
		deploymentScale: text('deployment_scale'),
		// Nullable on purpose: null = never shown the question; false = shown and declined.
		contactPermission: integer('contact_permission', { mode: 'boolean' }),
		contactMethod: text('contact_method'),
		// --- v2 step 4B (DAR-63) ---
		researchPreferences: text('research_preferences', { mode: 'json' }).$type<string[]>(),
		// Highest flow step COMPLETED (1 = signup … 4 = a branch), bumped monotonically by the step
		// updates — the classifier/funnel's "where did they stop". Null = row created before the v2
		// migration; a new signup on the still-live v1 form completed step 1 ("secure the signup"), so
		// it correctly reads 1. Step 4 does NOT record which branch: derive it from the branch-specific
		// columns (pilot_interest set → branch A; research_preferences set → branch B), so DAR-65/66
		// need no extra column and no backfill.
		qualificationStep: integer('qualification_step'),
		// --- Step-write budget (DAR-68) ---
		// The throttle for the token-gated steps 2–4, which are unauthenticated writes: a fixed window
		// per ROW, because a continuation token addresses exactly one row and that makes the row the
		// real abuse unit (per-IP would punish shared NATs for a bound this already gets exactly).
		//
		// These live on the row rather than in a counter table for one reason, and it's the whole
		// design: `applyWaitlistStep` reads and bumps them INSIDE the UPDATE it was already making
		// (see waitlist-store.ts), so a legitimate step costs no extra query and a throttled one costs
		// LESS than the write it replaces — the opposite of a DB-backed limiter, which spends a read
		// plus a write to refuse a write, i.e. protects the database by hammering it.
		//
		// Null on every pre-DAR-68 row and on every row that has never taken a step write; the guard
		// coalesces rather than backfilling.
		stepWriteCount: integer('step_write_count'),
		// Start of the current window, on the DB clock (the guard compares and stamps in one statement,
		// so a Worker/Turso skew can't shift one against the other). Not advanced by writes inside a
		// live window — a fixed window from the first write, not a sliding one — and a REFUSED write
		// doesn't touch it either, so hammering can't extend its own lockout.
		stepWriteWindowAt: integer('step_write_window_at', { mode: 'timestamp_ms' }),
		// --- Invite-only onboarding (DAR-67) ---
		// Public self-signup is closed, so an account exists only because staff invited this prospect
		// from /admin/waitlist. These three columns are the invite's state machine, and they live HERE
		// rather than on `user` because the un-invited majority has no `user` row to hang them off —
		// "not invited" is the default state of a waitlist entry, not of an account.
		//
		// `invited_at` is the MOST RECENT send, not the first: the operational question a triage view
		// answers is "did I already email them, and when", and a resend that left the timestamp stale
		// would answer it wrongly. The full history is the per-invite Workers Logs line.
		invitedAt: integer('invited_at', { mode: 'timestamp_ms' }),
		// The staff account id that sent it. A plain text column, deliberately NOT a foreign key to
		// `user`: this is an audit breadcrumb, and deleting a departed operator must not either cascade
		// away the record of who invited whom or block the delete.
		invitedBy: text('invited_by'),
		// When the invitee actually set their password — stamped by auth.ts's `onPasswordReset` hook,
		// and MONOTONIC (only ever fills a null). The hook additionally requires `invited_at` to be
		// set, so an ordinary self-service reset by someone who was never invited can't backfill this
		// and make the badge claim an activation that never happened.
		activatedAt: integer('activated_at', { mode: 'timestamp_ms' }),
		ipHash: text('ip_hash'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	},
	(table) => [
		// Functional unique index on lower(email) → case-insensitive dedupe at the DB layer,
		// independent of the writer normalizing. The insert path uses onConflictDoNothing() with no
		// explicit target (this is the only unique constraint), so it catches this conflict.
		uniqueIndex('waitlist_email_idx').on(sql`lower(${table.email})`),
		index('waitlist_ip_created_idx').on(table.ipHash, table.createdAt),
		index('waitlist_created_idx').on(table.createdAt),
		// Backs the /waitlist datalist frequency query (group by interest having count >= n).
		index('waitlist_interest_idx').on(table.interest)
	]
);

// Waitlist funnel analytics (DAR-66) — first-party, and the whole table is three columns because the
// privacy posture is structural rather than procedural: an event slug, an anonymous per-page-load
// `flow_id`, and when. There is no column for an IP, a user agent, an email, a row id or any answer
// text, so no future writer can quietly start recording one. The free-text answers (deployment scale,
// the money questions) are internal-only by DAR-58 and have nowhere to land here.
//
// `flow_id` is minted by /waitlist's load as a random UUID and carried through the flow in a hidden
// field. It is NOT the waitlist row id and NOT derived from the email — an analytics row must not be
// walkable back to a person, and a derived id would be joinable to `waitlist` by anyone who could
// recompute it. Shape-checked on write (isWaitlistFlowId).
//
// THE COMPOSITE PRIMARY KEY IS THE ABUSE CAP. The ticket asks for a per-flow event cap; making
// (flow_id, event) the key enforces it in the same statement as the insert — with
// `onConflictDoNothing()` a flow can never hold more than one row per event, so it is bounded to the
// slug list's length no matter how many times a script replays a submit, and no counting query is
// needed to enforce it. It also makes every count a count of DISTINCT flows, which is what turns
// `waitlist_signup_completed / waitlist_viewed` into a conversion rate instead of a ratio of retries.
// That's why this table has no surrogate `id` column like its siblings: (flow_id, event) IS the key.
//
// Writes are fire-and-forget (see src/lib/server/waitlist-funnel.ts) — analytics must never fail a
// signup, the same posture as the Resend notifications.
export const waitlistFunnelEvent = sqliteTable(
	'waitlist_funnel_event',
	{
		flowId: text('flow_id').notNull(),
		event: text('event').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	},
	(table) => [
		primaryKey({ columns: [table.flowId, table.event] }),
		// Backs the admin readout's `group by event` (a narrower scan than the table).
		index('waitlist_funnel_event_idx').on(table.event)
	]
);

export * from './auth.schema';
