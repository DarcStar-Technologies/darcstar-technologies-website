// Invite-only onboarding (DAR-67) — the database half: looking up whether an address already has an
// account, and the two timestamp stamps that move a prospect through not-invited → invited →
// activated. Server-only; the state vocabulary and its derivation are client-safe ($lib/waitlist-invite.ts).
//
// These stamps address the LEAD since DAR-88, not a signup row. An invitation is something we did to a
// PERSON — they now have (or are being offered) one account — and a person has N submissions, so
// hanging it off one arbitrary submission would leave the others looking un-invited and would make
// "have I already emailed them?" depend on which row an operator happened to be looking at.
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { waitlistLead, waitlistSubmission } from './db/schema';
import { user } from './db/auth.schema';
import { isStaff } from './admin-access';

/** What the invite action needs to know about a pre-existing account for an address. */
export interface ExistingAccount {
	id: string;
	role: string | null;
	/** True when this account can reach /admin — an admin, an operator, or an env-allowlisted owner. */
	isStaff: boolean;
	/**
	 * True when the roster has disabled this account. The invite must refuse it: setting a password
	 * does not lift a ban, so the prospect would follow a working link, choose a password, and then be
	 * unable to sign in — a dead end nobody in the loop would understand.
	 */
	banned: boolean;
}

/**
 * Find the account for `email`, if any.
 *
 * Queried directly rather than through `auth.api.listUsers` on purpose: that endpoint is admin-only,
 * and /admin/waitlist admits OPERATORS too (DAR-67 gates the invite on `isStaff`, like the rest of
 * the area). Routing an operator's invite through an admin-only lookup would 403 them at a step that
 * only reads.
 *
 * Case-insensitive: Better Auth lowercases account emails, and although the lead's email is stored
 * lowercase, a legacy value reading `Ada@Example.com` must still find the account.
 */
export async function findAccountByEmail(
	db: Db,
	email: string,
	adminUserIdsCsv: string | undefined
): Promise<ExistingAccount | null> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return null;
	const rows = await db
		.select({ id: user.id, role: user.role, banned: user.banned })
		.from(user)
		.where(eq(sql`lower(${user.email})`, normalized))
		.limit(1);
	const found = rows.at(0);
	if (!found) return null;
	return {
		id: found.id,
		role: found.role,
		isStaff: isStaff(found, adminUserIdsCsv),
		// The column is nullable (the admin plugin defaults it to false but pre-plugin rows are null),
		// so coerce rather than pass it through — `banned: null` reaching a `!banned` check reads as
		// "not banned", which is the right answer, but the type shouldn't make callers think about it.
		banned: found.banned === true
	};
}

/**
 * Who to address an invitation to, for one lead.
 *
 * The email comes from the LEAD (it is the lead's identity — the one field no submission can change,
 * since a differing address would simply be a different lead). The name comes from that lead's
 * EARLIEST submission that supplied one, and the "earliest" is the load-bearing part: under
 * append-only anyone can add a submission for a known address, so taking the newest name would let a
 * stranger choose the greeting on an email we send to the real person's inbox. Oldest-non-null keeps
 * the pre-DAR-88 behaviour exactly — step 1's enrich was fill-forward on `name`, so the first one
 * given always won — without needing a stored copy of it.
 *
 * Returns null when the lead is gone (deleted between render and click).
 *
 * `doNotContactAt` rides along (DAR-191) so the invite's refusal costs no second lookup — the action
 * checks it before anything is created or minted. Returned as the raw column rather than a boolean, so
 * the one place that decides what it MEANS is `mayContactLead`.
 */
export async function findWaitlistInviteTarget(
	db: Db,
	leadId: string
): Promise<{ email: string; name: string | null; doNotContactAt: Date | null } | null> {
	const [lead] = await db
		.select({ email: waitlistLead.email, doNotContactAt: waitlistLead.doNotContactAt })
		.from(waitlistLead)
		.where(eq(waitlistLead.id, leadId))
		.limit(1);
	if (!lead) return null;

	const [named] = await db
		.select({ name: waitlistSubmission.name })
		.from(waitlistSubmission)
		.where(and(eq(waitlistSubmission.leadId, leadId), isNotNull(waitlistSubmission.name)))
		.orderBy(waitlistSubmission.createdAt)
		.limit(1);

	return { email: lead.email, name: named?.name ?? null, doNotContactAt: lead.doNotContactAt };
}

/**
 * Record that an invitation went out. Called ONLY after the email has actually been accepted by
 * Resend, so `invited_at` means "a message was sent", never "we tried".
 *
 * `invited_at` is overwritten on a resend rather than kept at the first send: the question a triage
 * view has to answer is "did I already email them, and how long ago", and a stale first-contact
 * timestamp answers it wrongly. The per-invite Workers Logs line keeps the full history.
 *
 * Touches only the lead, never a submission: the submissions are an immutable record of what people
 * told us, and our own outreach is not something they said.
 */
export async function markWaitlistInvited(
	db: Db,
	leadId: string,
	invitedBy: string
): Promise<void> {
	await db
		.update(waitlistLead)
		.set({ invitedAt: new Date(), invitedBy })
		.where(eq(waitlistLead.id, leadId));
}

/**
 * Stamp `activated_at` for the invited prospect at `email`, if there is one. Returns how many leads
 * were stamped (0 or 1) so the caller can log it.
 *
 * Two conditions in the WHERE clause, and both are the point:
 *
 *   `invited_at IS NOT NULL` — this runs from auth.ts's `onPasswordReset`, which fires for EVERY
 *   password reset on the site, not just an activation. Without this, an ordinary self-service reset
 *   by someone who happens to be on the waitlist but was never invited would flip their badge to
 *   "activated", asserting an onboarding that never happened.
 *
 *   `activated_at IS NULL` — monotonic. The column records when they FIRST set a password; a routine
 *   reset years later must not rewrite that, or the field silently becomes "last password change".
 *
 * Keyed by email rather than by id because that is all the auth hook knows — and it stays a
 * single-row update under append-only precisely because the uniqueness moved to the lead: run against
 * the submissions it would now stamp every row that address ever created.
 */
export async function markWaitlistActivated(db: Db, email: string): Promise<number> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return 0;
	const rows = await db
		.update(waitlistLead)
		.set({ activatedAt: new Date() })
		.where(
			and(
				eq(sql`lower(${waitlistLead.email})`, normalized),
				isNotNull(waitlistLead.invitedAt),
				isNull(waitlistLead.activatedAt)
			)
		)
		.returning({ id: waitlistLead.id });
	return rows.length;
}

/**
 * Stamp "a human has reconciled this lead's submissions" (DAR-88). Idempotent by design — re-marking
 * an already-reviewed lead refreshes the stamp, because the useful reading is "last looked at", and a
 * lead that gains a new submission after review genuinely does need looking at again.
 *
 * Deliberately NOT a merge: nothing is copied from a submission onto the lead. The reconciliation
 * lands in whatever the operator does next (an outreach, a CRM record); a merged-answers column set
 * here would rebuild the overwrite problem DAR-88 exists to remove, only with a nicer UI on it.
 */
export async function markWaitlistReviewed(
	db: Db,
	leadId: string,
	reviewedBy: string
): Promise<void> {
	await db
		.update(waitlistLead)
		.set({ reviewedAt: new Date(), reviewedBy })
		.where(eq(waitlistLead.id, leadId));
}
