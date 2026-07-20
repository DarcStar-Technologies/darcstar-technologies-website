import { fail, redirect, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { USERS_LIMIT, ownerIds, adminErrorCode } from '$lib/server/admin-users';
import type { PageServerLoad } from './$types';

// Operator roster (admin-only — guarded by admin/users/+layout.server.ts). Lists accounts that can
// sign in to the admin area and creates new ones. Per-account management (edit/role/reset/disable/
// force-logout/delete) lives on the detail page (/admin/users/[id]).
export const load: PageServerLoad = async ({ request, locals }) => {
	// getAuth() reads platform.env via getRequestEvent(), so resolve it before the first await.
	const auth = getAuth();
	const res = await auth.api.listUsers({
		query: { limit: USERS_LIMIT, sortBy: 'createdAt', sortDirection: 'desc' },
		headers: request.headers
	});
	return {
		users: res.users,
		total: res.total ?? res.users.length,
		limit: USERS_LIMIT,
		// For row badges ("You" / "Owner"); the current user is always present via the layout too.
		currentUserId: locals.user!.id,
		ownerIds: ownerIds()
	};
};

export const actions: Actions = {
	// Create an operator. This is an admin endpoint, so it bypasses the public-sign-up lockout
	// (#48). New accounts default to the `user` role (a plain operator); an admin can promote later.
	create: async ({ request }) => {
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
