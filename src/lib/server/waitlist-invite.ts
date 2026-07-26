// Invite-only onboarding (DAR-67) — the database half: looking up whether an address already has an
// account, and the two timestamp stamps that move a waitlist row through not-invited → invited →
// activated. Server-only; the state vocabulary and its derivation are client-safe ($lib/waitlist-invite.ts).
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { waitlist } from './db/schema';
import { user } from './db/auth.schema';
import { isStaff } from './admin-access';

/** What the invite action needs to know about a pre-existing account for an address. */
export interface ExistingAccount {
	id: string;
	role: string | null;
	/** True when this account can reach /admin — an admin, an operator, or an env-allowlisted owner. */
	isStaff: boolean;
}

/**
 * Find the account for `email`, if any.
 *
 * Queried directly rather than through `auth.api.listUsers` on purpose: that endpoint is admin-only,
 * and /admin/waitlist admits OPERATORS too (DAR-67 gates the invite on `isStaff`, like the rest of
 * the area). Routing an operator's invite through an admin-only lookup would 403 them at a step that
 * only reads.
 *
 * Case-insensitive: Better Auth lowercases account emails, but the waitlist column stores whatever
 * the visitor typed, so a row reading `Ada@Example.com` must still find the account.
 */
export async function findAccountByEmail(
	db: Db,
	email: string,
	adminUserIdsCsv: string | undefined
): Promise<ExistingAccount | null> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return null;
	const rows = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(sql`lower(${user.email})`, normalized))
		.limit(1);
	const found = rows.at(0);
	if (!found) return null;
	return { ...found, isStaff: isStaff(found, adminUserIdsCsv) };
}

/**
 * Record that an invitation went out. Called ONLY after the email has actually been accepted by
 * Resend, so `invited_at` means "a message was sent", never "we tried".
 *
 * `invited_at` is overwritten on a resend rather than kept at the first send: the question a triage
 * view has to answer is "did I already email them, and how long ago", and a stale first-contact
 * timestamp answers it wrongly. The per-invite Workers Logs line keeps the full history.
 */
export async function markWaitlistInvited(
	db: Db,
	waitlistId: string,
	invitedBy: string
): Promise<void> {
	await db
		.update(waitlist)
		.set({ invitedAt: new Date(), invitedBy, updatedAt: new Date() })
		.where(eq(waitlist.id, waitlistId));
}

/**
 * Stamp `activated_at` for the invited prospect at `email`, if there is one. Returns how many rows
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
 * Deliberately does not touch `updated_at`: that column tracks the visitor's own edits to their
 * qualification answers, and this is our stamp, not theirs.
 */
export async function markWaitlistActivated(db: Db, email: string): Promise<number> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return 0;
	const rows = await db
		.update(waitlist)
		.set({ activatedAt: new Date() })
		.where(
			and(
				eq(sql`lower(${waitlist.email})`, normalized),
				isNotNull(waitlist.invitedAt),
				isNull(waitlist.activatedAt)
			)
		)
		.returning({ id: waitlist.id });
	return rows.length;
}
