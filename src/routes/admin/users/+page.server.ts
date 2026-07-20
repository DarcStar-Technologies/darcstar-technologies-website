import { fail, redirect, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
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
	// Create an operator. This is an admin endpoint, so it bypasses the public-sign-up lockout
	// (#48). New accounts default to the `user` role (a plain operator); an admin can promote later.
	create: async ({ request, locals }) => {
		// Form actions skip the layout guard, so authorize here (before the first await).
		if (!rosterAdmin(locals)) return fail(403, { create: { error: 'forbidden' as const } });
		const auth = getAuth();
		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const password = String(data.get('password') ?? '');
		const role = data.get('role') === 'admin' ? 'admin' : 'user';
		const values = { email, name, role };

		if (!email || !name) return fail(400, { create: { values, error: 'missing' as const } });
		if (password.length < 8) {
			return fail(400, { create: { values, error: 'password_short' as const } });
		}

		let created;
		try {
			created = await auth.api.createUser({
				body: { email, name, password, role },
				headers: request.headers
			});
		} catch (err) {
			return fail(400, { create: { values, error: adminErrorCode(err) } });
		}
		// Land on the new operator's detail page. Outside the try — redirect() throws to signal.
		redirect(303, `/admin/users/${created.user.id}`);
	}
};
