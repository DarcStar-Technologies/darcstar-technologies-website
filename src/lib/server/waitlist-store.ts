// Waitlist DB write — extracted from the remote (waitlist.remote.ts) so it's testable against an
// in-memory libsql client (waitlist-store.spec.ts) without a request context.
//
// The shape is insert-OR-enrich, and it reports which happened via `isNew`. That flag is
// load-bearing: the caller sends the welcome emails ONLY on a genuine new signup. Without it, a
// re-signup of the same email would re-mail on every submit — and because the IP/time throttle
// counts ROWS (and a re-signup UPSERTs rather than inserting a new row), same-email replays never
// trip the throttle, which would turn the ack into an unthrottled mailbomb aimed at any address an
// attacker types in (and a flood into info@). Gating emails on `isNew` closes that.
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { waitlist } from './db/schema';
import type { CleanedWaitlist } from './waitlist';

// `coalesce(<new>, <existing-column>)` — on enrich, a provided value wins; a blank (null, since the
// validator nulls empties) keeps whatever's already stored. So a returning user fills gaps / updates
// fields they re-enter, and never erases data by submitting a sparser form.
function keepExisting(next: string | null, column: string) {
	return sql`coalesce(${next}, ${sql.raw(column)})`;
}

/**
 * Insert a new signup, or enrich the existing row when this email is already on the list. Returns
 * `{ isNew }` so the caller can gate the welcome emails on a genuine first signup.
 *
 * Race-free: `insert … onConflictDoNothing().returning()` lets the DB atomically decide insert vs.
 * conflict (the unique index is on `lower(email)`), so two concurrent first-signups can't both be
 * treated as new. `onConflictDoNothing()` takes no target — `waitlist` has a single unique
 * constraint, and the functional lower(email) index wouldn't match an `(email)` target anyway.
 */
export async function upsertWaitlist(
	db: Db,
	sub: CleanedWaitlist,
	ipHash: string,
	userAgent: string | null
): Promise<{ isNew: boolean }> {
	const inserted = await db
		.insert(waitlist)
		.values({
			email: sub.email,
			name: sub.name,
			company: sub.company,
			role: sub.role,
			companySize: sub.companySize,
			interest: sub.interest,
			hearAbout: sub.hearAbout,
			phone: sub.phone,
			ipHash,
			userAgent
		})
		.onConflictDoNothing()
		.returning({ id: waitlist.id });

	if (inserted.length > 0) return { isNew: true };

	// Already on the list — enrich in place, bump updated_at (same clock as the DB default).
	await db
		.update(waitlist)
		.set({
			name: keepExisting(sub.name, 'name'),
			company: keepExisting(sub.company, 'company'),
			role: keepExisting(sub.role, 'role'),
			companySize: keepExisting(sub.companySize, 'company_size'),
			interest: keepExisting(sub.interest, 'interest'),
			hearAbout: keepExisting(sub.hearAbout, 'hear_about'),
			phone: keepExisting(sub.phone, 'phone'),
			updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`
		})
		.where(eq(waitlist.email, sub.email));

	return { isNew: false };
}
