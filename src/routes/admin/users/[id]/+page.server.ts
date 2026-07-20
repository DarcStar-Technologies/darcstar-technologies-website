import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { ownerIds, guardTarget, adminErrorCode } from '$lib/server/admin-users';
import type { PageServerLoad } from './$types';

// Single-operator management (admin-only). Everything the roster can do to one account:
// edit name/email, change role, reset password, force logout everywhere, disable/enable, delete.
// Destructive/role/session/password actions are blocked against your own account and owner
// (ADMIN_USER_IDS) accounts — see guardTarget in admin-users.ts.

export const load: PageServerLoad = async ({ params, request, locals }) => {
	// getAuth() reads platform.env via getRequestEvent(), so resolve it before the first await.
	const auth = getAuth();

	let target;
	try {
		target = await auth.api.getUser({ query: { id: params.id }, headers: request.headers });
	} catch {
		// getUser throws NOT_FOUND for an unknown id (also covers a malformed id).
		error(404, 'Operator not found');
	}

	const { sessions } = await auth.api.listUserSessions({
		body: { userId: params.id },
		headers: request.headers
	});

	const owners = ownerIds();
	return {
		target,
		sessions,
		isSelf: params.id === locals.user!.id,
		isOwner: owners.includes(params.id),
		// The account can be role-changed / disabled / reset / force-logged-out / deleted only when
		// it's neither yours nor an owner's. Drives which controls the detail page renders.
		manageable: params.id !== locals.user!.id && !owners.includes(params.id)
	};
};

// `[id]` guarantees params.id at runtime, but contextual typing through the `Actions` Record
// doesn't narrow it (unlike `load`), so it types as `string | undefined` — assert it per action.
export const actions: Actions = {
	// Edit name + email. Allowed on any account (non-destructive) — email is the sign-in identity.
	updateDetails: async ({ params, request }) => {
		const userId = params.id!;
		const auth = getAuth();
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const email = String(data.get('email') ?? '').trim();
		const values = { name, email };
		if (!name || !email) return fail(400, { scope: 'details', error: 'missing', values });
		try {
			await auth.api.adminUpdateUser({
				body: { userId, data: { name, email } },
				headers: request.headers
			});
		} catch (err) {
			return fail(400, { scope: 'details', error: adminErrorCode(err), values });
		}
		return { scope: 'details', ok: true };
	},

	// Promote to admin / demote to operator. Blocked on self + owner.
	setRole: async ({ params, request, locals }) => {
		const userId = params.id!;
		const blocked = guardTarget(userId, locals.user!.id);
		if (blocked) return fail(403, { scope: 'role', error: blocked });
		const auth = getAuth();
		const data = await request.formData();
		const role = data.get('role') === 'admin' ? 'admin' : 'user';
		try {
			await auth.api.setRole({ body: { userId, role }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'role', error: adminErrorCode(err) });
		}
		return { scope: 'role', ok: true };
	},

	// Set a new password (the admin shares it out-of-band). Blocked on self + owner.
	resetPassword: async ({ params, request, locals }) => {
		const userId = params.id!;
		const blocked = guardTarget(userId, locals.user!.id);
		if (blocked) return fail(403, { scope: 'password', error: blocked });
		const auth = getAuth();
		const data = await request.formData();
		const newPassword = String(data.get('newPassword') ?? '');
		if (newPassword.length < 8) return fail(400, { scope: 'password', error: 'password_short' });
		try {
			await auth.api.setUserPassword({
				body: { userId, newPassword },
				headers: request.headers
			});
		} catch (err) {
			return fail(400, { scope: 'password', error: adminErrorCode(err) });
		}
		return { scope: 'password', ok: true };
	},

	// Revoke every session — the "force logout everywhere" kill switch. Blocked on self + owner.
	forceLogout: async ({ params, request, locals }) => {
		const userId = params.id!;
		const blocked = guardTarget(userId, locals.user!.id);
		if (blocked) return fail(403, { scope: 'session', error: blocked });
		const auth = getAuth();
		try {
			await auth.api.revokeUserSessions({
				body: { userId },
				headers: request.headers
			});
		} catch (err) {
			return fail(400, { scope: 'session', error: adminErrorCode(err) });
		}
		return { scope: 'session', ok: true };
	},

	// Reversible lockout: block sign-in + revoke sessions, keep the row/history. Blocked on self +
	// owner (the plugin also blocks self-ban).
	disable: async ({ params, request, locals }) => {
		const userId = params.id!;
		const blocked = guardTarget(userId, locals.user!.id);
		if (blocked) return fail(403, { scope: 'status', error: blocked });
		const auth = getAuth();
		try {
			await auth.api.banUser({ body: { userId }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'status', error: adminErrorCode(err) });
		}
		return { scope: 'status', ok: true };
	},

	// Lift a disable. Safe to run on anyone (only restores access), so it's unguarded.
	enable: async ({ params, request }) => {
		const userId = params.id!;
		const auth = getAuth();
		try {
			await auth.api.unbanUser({ body: { userId }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'status', error: adminErrorCode(err) });
		}
		return { scope: 'status', ok: true };
	},

	// Permanent hard delete (cascades sessions/accounts). Blocked on self + owner (the plugin also
	// blocks self-remove). Redirects back to the roster.
	delete: async ({ params, request, locals }) => {
		const userId = params.id!;
		const blocked = guardTarget(userId, locals.user!.id);
		if (blocked) return fail(403, { scope: 'delete', error: blocked });
		const auth = getAuth();
		try {
			await auth.api.removeUser({ body: { userId }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'delete', error: adminErrorCode(err) });
		}
		redirect(303, '/admin/users');
	}
};
