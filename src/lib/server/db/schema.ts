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

// The COLLATED PERSON behind one or more waitlist submissions (DAR-88). One row per distinct email,
// case-insensitively — this table carries the `lower(email)` unique index that `waitlist` used to.
//
// IT HOLDS NO ANSWERS, AND THAT IS THE DESIGN. Every answer stays on the submission that made it
// (`waitlist_submission` below). A lead is an identity anchor plus the things that describe a PERSON
// rather than a submission: whether we have invited them, whether they activated, whether a human has
// reviewed their submissions. Nothing here is written by two different actors, so no "who may
// overwrite what" policy can grow back — which is the whole point of DAR-88. Conflicting answers
// across submissions are surfaced to an operator, never resolved into a column.
//
// TWO JOBS, AND THE FIRST ONE IS LOAD-BEARING:
//
//   1. It IS the `isNew` gate. `insert … onConflictDoNothing().returning()` against the unique index
//      makes the DATABASE decide whether this address has ever been seen, atomically, in the same
//      statement that creates the lead — so the welcome/ack email still fires only on a genuine first
//      signup, with no counting query and no race between two concurrent first-signups. That gate is
//      the mailbomb guard (see waitlist-store.ts): without it, a replay of a known address would mail
//      the ack at whatever third party an attacker typed, and the per-IP throttle can't stop it
//      because distinct-email floods are its only shape.
//   2. It gives the invite state somewhere to live that survives N submissions. `invited_at` /
//      `activated_at` describe an ACCOUNT handed to a person; hanging them off one arbitrary
//      submission (as pre-DAR-88 rows did) would mean a later submission looked un-invited.
//
// Deliberately NOT a foreign key to `user`: the vast majority of leads have no account, and DAR-67's
// invite is the only thing that ever mints one.
export const waitlistLead = sqliteTable(
	'waitlist_lead',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// Stored lowercase (the validator normalizes, and the store lowercases again at its boundary).
		// The unique index is functional on lower(email) anyway, so a mixed-case write still dedupes.
		email: text('email').notNull(),
		// --- Invite-only onboarding (DAR-67), moved here from the signup row by DAR-88 ---
		// Public self-signup is closed, so an account exists only because staff invited this prospect
		// from /admin/waitlist. These live on the LEAD because they describe the person, not one of
		// their submissions — and because "not invited" is the default state of a prospect, not of an
		// account, they can't live on `user` either (the un-invited majority has no `user` row).
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
		// --- Priority-A notification (DAR-82) ---
		// "We have told info@ about this person." Set exactly once, ever, the first time any of their
		// submissions classifies Priority A (waitlist-priority-notify.ts).
		//
		// THIS COLUMN IS THE ABUSE CAP, not a record of it. The send is triggered by an unauthenticated
		// visitor's step write, so it needs a bound, and the bound is
		// `UPDATE … WHERE priority_a_notified_at IS NULL RETURNING id`: one row back means this call and
		// no other claimed the notification. Same move as `waitlist_funnel_event`'s composite key and as
		// `isNew` on the lead insert — the database decides, in the statement that does the work, so
		// there is no counting query and no read-then-write race between two concurrent submits.
		//
		// PER LEAD, therefore, and that is the number that matters: a stranger can append submissions
		// under a known address all day (append-only accepts that cost), and every one of them together
		// can produce at most this single email. Deliberately NOT a global rate cap, which would be a
		// denial-of-notification primitive — flood it and real Priority-A leads go unannounced.
		//
		// On the lead rather than the submission for the same reason `invited_at` is: this records
		// something WE did about a person. The submissions stay an immutable record of what people told
		// us, and our own outreach is not something they said.
		priorityANotifiedAt: integer('priority_a_notified_at', { mode: 'timestamp_ms' }),
		// --- Product-and-research updates: the sending gate (DAR-139) ---
		// `waitlist_submission.consent_updates` is an UNVERIFIED single-opt-in claim — the form is
		// unauthenticated, so a third party can type any address in and tick the box. These three
		// columns are what turns that claim into something we may act on, and /privacy states the rule
		// publicly (DAR-121), so they are a promise as much as a schema.
		//
		// ON THE LEAD, and unlike `invited_at` this one is FORCED rather than merely consistent with
		// DAR-88. A withdrawal is a decision about a PERSON: recording it per submission would need a
		// write reaching across N immutable rows, which is exactly what append-only forbids. The
		// submission keeps saying what one submitter claimed at one moment; the lead carries where that
		// address now stands.
		//
		// When we last ASKED — i.e. sent the confirmation request. THE CAP, and like
		// `priority_a_notified_at` it is the cap rather than a record of one: the send is triggered by an
		// unauthenticated visitor's submit, so it needs a bound, and the bound is a conditional UPDATE
		// (`claimUpdatesConfirmSend`, waitlist-store.ts) that only matches when this is null or older
		// than the window. One row back means this call and no other may send.
		//
		// A WINDOW, not `IS NULL` — the opposite polarity to DAR-82, and the difference is who receives
		// the mail. That one claims once ever because a lost notification lands in our own inbox with an
		// operator standing over it; this one goes to a member of the public who may simply lose it, so
		// re-ticking the box tomorrow has to be able to ask again. What it bounds is the new exposure
		// append-only leaves open: a stranger submitting a known address can cause at most one
		// confirmation request per day to it, and the "don't ask again" link inside that very email ends
		// it permanently in one click.
		updatesConfirmSentAt: integer('updates_confirm_sent_at', { mode: 'timestamp_ms' }),
		// When the MAILBOX clicked confirm. THE ONLY THING THAT AUTHORIZES A SEND — a ticked box never
		// does, however many submissions carry one. Stamped by a POST from /updates/confirm, never by a
		// GET: mail scanners follow links, and a GET-confirm is a scanner-manufactured opt-in, which is
		// double opt-in that verifies nothing.
		updatesConfirmedAt: integer('updates_confirmed_at', { mode: 'timestamp_ms' }),
		// When they withdrew. DURABLE: it suppresses every future confirmation request and every send,
		// and the unauthenticated form can never undo it — a re-tick is refused by the claim above, and
		// an old confirm link clicked afterwards reports the opt-out rather than reversing it. The form
		// is the one surface a stranger controls, so if a re-tick could restart the asks, unsubscribing
		// would stop one message instead of the relationship. Re-entry needs a channel the form cannot
		// reach (email us — /privacy says so).
		//
		// `updates_confirmed_at` is deliberately LEFT STANDING when this is set: it is the audit trail of
		// what actually happened, `mayReceiveUpdates` already excludes a withdrawn lead, and clearing it
		// would destroy evidence to buy nothing.
		updatesUnsubscribedAt: integer('updates_unsubscribed_at', { mode: 'timestamp_ms' }),
		// WHO recorded that withdrawal (DAR-140), and the two values mean different things rather than one
		// being a missing case of the other. NULL is the mailbox holder pressing the emailed link — the
		// strongest evidence there is, since only they can read it. A staff user id is us transcribing a
		// request that arrived some other way (a reply, info@, a phone call), because /privacy promises we
		// will act on one and the link is no use to somebody who deleted the email.
		//
		// The distinction only became UNINFERABLE when the second writer existed: until DAR-140 a set
		// `updates_unsubscribed_at` could only have come from the link. So this column is not decoration
		// on an audit trail, it is the part of it that stopped being derivable.
		//
		// Plain text and no foreign key, like `invited_by` and `reviewed_by`: an audit breadcrumb must not
		// cascade away with a departed operator's account, nor block deleting it. Written under the same
		// first-writer-wins guard as the timestamp beside it (`unsubscribeUpdates`), so a later staff press
		// cannot overwrite the record of somebody having unsubscribed themselves.
		updatesUnsubscribedBy: text('updates_unsubscribed_by'),
		// --- Human review (DAR-88) ---
		// "A human has looked at this lead's submissions and reconciled them." Deliberately a STAMP and
		// not a merge: the reconciliation lands in whatever the operator does next (an outreach, a CRM
		// record), not in columns here, because a merged-answers column set would be the overwrite
		// problem again with a nicer UI. Null = awaiting review, which is every lead's initial state.
		reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
		reviewedBy: text('reviewed_by'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	},
	(table) => [
		// Functional unique index on lower(email) → case-insensitive dedupe at the DB layer,
		// independent of the writer normalizing. The insert path uses onConflictDoNothing() with no
		// explicit target (this is the only unique constraint), so it catches this conflict — and the
		// returned row count IS `isNew`.
		uniqueIndex('waitlist_lead_email_idx').on(sql`lower(${table.email})`),
		index('waitlist_lead_created_idx').on(table.createdAt)
	]
);

// Waitlist signups — early-access lead capture, a lighter-touch sibling of `contact_submission`.
// Written by the `joinWaitlist` remote function (src/lib/waitlist.remote.ts) after honeypot +
// validation + throttle, mirroring the contact flow (`ip_hash` is the same truncated SHA-256, never
// the raw IP; the (ip_hash, created_at) index backs the throttle lookback).
//
// APPEND-ONLY SINCE DAR-88, and this is the security boundary rather than a storage preference. Every
// submit inserts a row; a repeat email is a NEW row under the same lead, never an edit of the old one.
// Before that, a repeat email collapsed into the existing row, which is what manufactured DAR-59's
// keepExisting/fillIfEmpty split and DAR-72's actionable/judgement taxonomy: two different actors
// could write one row, so every column needed a policy for who wins. Now they can't:
//
//   - Step 1's anti-enumeration property becomes TRUE instead of a cover story. The identical success
//     response for a new and an existing email used to hide a real difference, and hiding it meant
//     handing the second submitter a continuation token bound to the FIRST submitter's row. Now there
//     is no difference to hide — every submit really is new — so a stranger who guesses a known
//     address gets a token for THEIR OWN row and can never reach the real person's answers.
//   - `updated_at` and the token-gated step writes (2–4) only ever touch the row whose own token
//     minted them. A submission is immutable to everyone except the submitter who created it.
//   - Conflicting values are PRESERVED. Two different phone numbers for one address is exactly what an
//     operator should see; provided-wins and fill-forward both destroyed that, in opposite directions.
//
// What we store is now a fact ("someone submitted X at time T from this IP") rather than an inference
// ("this person's phone is X"). Cost, accepted: a repeat submitter grows the table, and a stranger can
// bury a real signup under junk rows. The per-IP row-count throttle bounds the rate — and it finally
// SEES these writes, since an enrich now creates a row instead of hiding inside an UPDATE — and the
// junk is visible rather than silently merged into the real record. Volumetric abuse from rotating IPs
// stays edge/WAF territory, the same boundary DAR-68 drew.
//
// Other notes:
//   - Only `email` is required; every other field is optional lead enrichment (progressive
//     disclosure on the form). `role`/`company_size`/`hear_about` are validated slugs; `interest`
//     is deliberately FREE TEXT (a growing list, not an enum) and `phone` is free text. The
//     `interest` index backs the /waitlist datalist's frequency query (group by interest).
//   - No `user_id`: a waitlist is pre-account lead capture, so rows are not linked to accounts. The
//     account-shaped state (invited/activated) lives on `waitlist_lead`.
//   - The v2 progressive flow (DAR-59) adds the qualification columns below the v1 block. All are
//     nullable (steps 2–4 are optional and reached via a signed continuation token — see
//     waitlist-token.ts); slugs are validated against $lib/waitlist-qualification.ts; the two
//     multi-selects store JSON string arrays. `company_size`/`interest`/`hear_about` predate v2 and
//     stay for their historical data even after the v2 UI stops writing them. `role` is shared:
//     v1 slugs remain as history, new writes use the v2 set.
export const waitlistSubmission = sqliteTable(
	'waitlist_submission',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// The collated person this submission belongs to. NOT NULL — a submission without a lead would
		// be a signup nobody could be emailed about — and cascade-deleting, so removing a lead from the
		// triage view takes its submissions with it rather than orphaning them.
		leadId: text('lead_id')
			.notNull()
			.references(() => waitlistLead.id, { onDelete: 'cascade' }),
		// What THIS submission claimed, kept alongside `lead_id` so a row reads standalone in a log or
		// an export. Always equal to the lead's email (the lead is resolved by it), so it is a
		// convenience, never a second source of truth.
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
		// Marketing-updates opt-in, PER SUBMISSION since DAR-88 — which is a straight compliance
		// upgrade over the monotonic row flag it replaces: the grant now carries the moment it was made
		// and the hashed IP it came from, in the same immutable row, instead of a boolean that had been
		// max()'d forward across an unknown number of submitters. False when the box wasn't ticked on
		// THIS submit; that is not a revocation of an earlier grant, because this row says nothing
		// about any other row. Revocation remains a deliberate future mechanism (an unsubscribe link),
		// not a form default.
		//
		// IMPORTANT, unchanged: this is an UNVERIFIED claim — the form is unauthenticated single-opt-in,
		// so a third party can submit any address with the box ticked. It must NOT drive a real send.
		//
		// Since DAR-139 it is the TRIGGER TO ASK and nothing more: a true here makes the server try to
		// claim one confirmation request for the lead, and permission arrives only if that mailbox clicks
		// (`waitlist_lead.updates_confirmed_at`). So this column's meaning is unchanged and its
		// consequence is now bounded — it can cause a question, never a send.
		consentUpdates: integer('consent_updates', { mode: 'boolean' }).default(false).notNull(),
		// When consent was granted on this submission (provenance for a compliance review). Null = the
		// box wasn't ticked here; separate from updated_at, which later step writes clobber.
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
		// Survives DAR-88 unchanged — the token now addresses its OWN submission, so this bounds a
		// holder hammering the row they created rather than one they reached by guessing an address.
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
		// (DAR-67's invited_at / invited_by / activated_at moved to `waitlist_lead` in DAR-88 — they
		// describe a person, and a person now has N submissions.)
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
		// NOTE what is NOT here any more: the `lower(email)` UNIQUE index. It moved to `waitlist_lead`,
		// and that single line is the DAR-88 change — uniqueness on the person, multiplicity on the
		// submissions. Re-adding it here would restore the collapse this table exists to prevent.
		//
		// Backs the admin view's per-lead grouping and the invite action's "name from the earliest
		// submission" lookup; (lead_id, created_at) rather than lead_id alone so both arrive ordered.
		index('waitlist_submission_lead_created_idx').on(table.leadId, table.createdAt),
		index('waitlist_submission_ip_created_idx').on(table.ipHash, table.createdAt),
		index('waitlist_submission_created_idx').on(table.createdAt),
		// Backs the /waitlist datalist frequency query (group by interest having count >= n).
		index('waitlist_submission_interest_idx').on(table.interest)
	]
);

// Waitlist funnel analytics (DAR-66) — first-party, and the whole table is three columns because the
// privacy posture is structural rather than procedural: an event slug, an anonymous per-page-load
// `flow_id`, and when. There is no column for an IP, a user agent, an email, a row id or any answer
// text, so no future writer can quietly start recording one. The free-text answers (deployment scale,
// the money questions) are internal-only by DAR-58 and have nowhere to land here.
//
// `flow_id` is minted by /waitlist's load as a random UUID and carried through the flow in a hidden
// field. It is NOT a submission or lead id and NOT derived from the email — an analytics row must not
// be walkable back to a person, and a derived id would be joinable to those tables by anyone who could
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
