import { fail, redirect, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { apiRole, coerceRole } from '$lib/server/admin-access';
import { linkSubmissionsToUser } from '$lib/server/contact-ownership';
import { USERS_LIMIT, ownerIds, rosterAdmin, adminErrorCode } from '$lib/server/admin-users';
import type { PageServerLoad } from './$types';

// Operator roster (admin-only — guarded by admin/users/+layout.server.ts). Lists accounts that can
// sign in to the admin area and creates new ones. Per-account management (edit/role/reset/disable/
// force-logout/delete) lives on the detail page (/admin/users/[id]).
export const load: PageServerLoad = async ({ request, locals }) => {
	// getAuth() + ownerIds() read platform.env via getRequestEvent(), so resolve them before the
	// first await (env can read back empty once the request's async context is left).
	const auth = getAuth();
	const owners = ownerIds();
	const currentUserId = locals.user!.id; // present via the /admin session hook
	const res = await auth.api.listUsers({
		query: { limit: USERS_LIMIT, sortBy: 'createdAt', sortDirection: 'desc' },
		headers: request.headers
	});
	return {
		users: res.users,
		total: res.total ?? res.users.length,
		limit: USERS_LIMIT,
		// For row badges ("You" / "Owner").
		currentUserId,
		ownerIds: owners
	};
};

export const actions: Actions = {
	// Create a user account. This is an admin endpoint, so it bypasses the public-sign-up lockout
	// (#48). New accounts default to the least-privileged `user` role (own account only, no /admin
	// access); the picker promotes to `operator` (message triage) or `admin` (full), and the role
	// stays editable later (#95).
	create: async ({ request, locals }) => {
		// Form actions skip the layout guard, so authorize here (before the first await).
		if (!rosterAdmin(locals)) return fail(403, { create: { error: 'forbidden' as const } });
		// Resolve request-scoped handles before the first await (env reads back empty once the async
		// context is left); `db` is for the post-create submission backfill below.
		const auth = getAuth();
		const db = getDb();
		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const password = String(data.get('password') ?? '');
		const role = coerceRole(data.get('role'), 'user');
		const values = { email, name, role };

		if (!email || !name) return fail(400, { create: { values, error: 'missing' as const } });
		if (password.length < 8) {
			return fail(400, { create: { values, error: 'password_short' as const } });
		}

		let created;
		try {
			created = await auth.api.createUser({
				body: { email, name, password, role: apiRole(role) },
				headers: request.headers
			});
		} catch (err) {
			return fail(400, { create: { values, error: adminErrorCode(err) } });
		}
		// Claim any existing anonymous submissions from this email for the new account (#96): the
		// admin, by typing the email, vouches for the email→person mapping (self-registrants instead
		// earn this by verifying the email — see auth.ts afterEmailVerification). Best-effort: a link
		// failure must not fail an already-created account, so log and continue to the redirect.
		try {
			await linkSubmissionsToUser(db, created.user.id, email);
		} catch (err) {
			console.error('linking submissions to new account failed', err);
		}
		// Land on the new user's detail page. Outside the try — redirect() throws to signal.
		redirect(303, `/admin/users/${created.user.id}`);
	}
};
