import { fail, type Actions } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { desc, eq } from 'drizzle-orm';
import { getAuth } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { contactSubmission } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

// End-user account portal (#96). The load lists ONLY this account's own messages (scoped to
// locals.user.id — the load-bearing isolation property), and the actions let the user manage their
// own profile (display name, password). Email is intentionally immutable here: it's the sign-in
// identity AND the key the message-ownership backfill links on (contact-ownership.ts), so changing
// it belongs to staff via /admin/users, not to self-service.

// Cap the read, mirroring the admin views (pagination is a later follow-up). A single account's own
// message count is small in practice; the cap is just a safety bound. Not exported — SvelteKit only
// allows its own reserved exports (+ `_`-prefixed) from a +page.server.
const MESSAGES_LIMIT = 200;

export const load: PageServerLoad = async ({ locals }) => {
	// Present via the /account session hook + layout guard; scope the query to this user only.
	const userId = locals.user!.id;
	const db = getDb();
	const messages = await db
		.select({
			id: contactSubmission.id,
			interest: contactSubmission.interest,
			message: contactSubmission.message,
			createdAt: contactSubmission.createdAt
		})
		.from(contactSubmission)
		.where(eq(contactSubmission.userId, userId))
		.orderBy(desc(contactSubmission.createdAt))
		.limit(MESSAGES_LIMIT);
	return { messages };
};

// Each action self-authorizes on `locals.user` — SvelteKit does NOT run the layout guard before a
// form action (only on the re-render). Both call Better Auth's self-service endpoints, which act on
// the CURRENT session's user (never a userId param), so there's no way to target another account.
// getAuth() reads env via getRequestEvent(), so resolve it before the first await.
export const actions: Actions = {
	// Update the display name (non-destructive; the only editable profile field).
	updateName: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { scope: 'profile', error: 'forbidden' });
		const auth = getAuth();
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { scope: 'profile', error: 'missing', name: '' });
		try {
			await auth.api.updateUser({ body: { name }, headers: request.headers });
		} catch (err) {
			console.error('account updateName failed', err);
			return fail(400, { scope: 'profile', error: 'generic', name });
		}
		// Echo the saved name back so the field shows it immediately: `locals.user` was resolved by
		// the hook BEFORE this action ran, so the same-request re-render's load still sees the old
		// name — without this, the field would revert to the pre-save value despite the success banner.
		return { scope: 'profile', ok: true, name };
	},

	// Change password. Better Auth verifies `currentPassword` and (with revokeOtherSessions) kills
	// every other session, keeping this one — the sveltekitCookies plugin re-sets the refreshed
	// session cookie. A wrong current password throws an APIError → the `invalid` code.
	changePassword: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { scope: 'password', error: 'forbidden' });
		const auth = getAuth();
		const data = await request.formData();
		const currentPassword = String(data.get('currentPassword') ?? '');
		const newPassword = String(data.get('newPassword') ?? '');
		if (newPassword.length < 8) return fail(400, { scope: 'password', error: 'password_short' });
		try {
			await auth.api.changePassword({
				body: { currentPassword, newPassword, revokeOtherSessions: true },
				headers: request.headers
			});
		} catch (err) {
			// Wrong current password (or any auth rejection) → generic "invalid" (non-enumerating).
			if (err instanceof APIError) return fail(400, { scope: 'password', error: 'invalid' });
			throw err;
		}
		return { scope: 'password', ok: true };
	}
};
