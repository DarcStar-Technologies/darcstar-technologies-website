// Message ownership (#96 end-user portal). Links anonymous `contact_submission` rows to an account
// so a `user` can see "their own messages" at /account. Kept as one small, db-handle-taking helper
// (no env, no $app import) so it's shared by every place a link becomes justified — and unit-testable.
//
// Three call sites, each a moment the email→account identity is trustworthy:
//   1. signed-in submit         — the submitter IS the account (contact.remote.ts).
//   2. admin creates an account — the admin vouches for the email (admin/users create action).
//   3. self-registered verify   — email verification PROVES ownership (auth.ts afterEmailVerification, #96 PR2).
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';

type Db = ReturnType<typeof getDb>;

/**
 * Claim every not-yet-owned submission whose email matches `email` (case-insensitively) for
 * `userId`. Only touches rows with `user_id IS NULL`, so it never re-assigns a submission already
 * linked to a different account. Returns the number of rows linked.
 *
 * Case-insensitive because sign-in emails and the free-text contact `email` may differ only in case;
 * Better Auth normalizes account emails, but the contact form stores whatever was typed.
 */
export async function linkSubmissionsToUser(
	db: Db,
	userId: string,
	email: string
): Promise<number> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return 0;
	const rows = await db
		.update(contactSubmission)
		.set({ userId })
		.where(
			and(isNull(contactSubmission.userId), eq(sql`lower(${contactSubmission.email})`, normalized))
		)
		.returning({ id: contactSubmission.id });
	return rows.length;
}
