import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { getAuth } from '$lib/server/auth';
import { apiRole, coerceRole } from '$lib/server/admin-access';
import { ownerIds, guardTarget, rosterAdmin, adminErrorCode } from '$lib/server/admin-users';
import type { PageServerLoad } from './$types';

// Single-operator management (admin-only). Everything the roster can do to one account:
// edit name/email, change role, reset password, force logout everywhere, disable/enable, delete.
// Destructive/role/session/password actions are blocked against your own account and owner
// (ADMIN_USER_IDS) accounts — see guardTarget in admin-users.ts.

export const load: PageServerLoad = async ({ params, request, locals }) => {
	// getAuth() + ownerIds() read platform.env via getRequestEvent(), so resolve them (and the acting
	// user's id) before the first await — env can read back empty once the async context is left.
	const auth = getAuth();
	const owners = ownerIds();
	const meId = locals.user!.id;

	let target;
	try {
		target = await auth.api.getUser({ query: { id: params.id }, headers: request.headers });
	} catch (err) {
		// A genuinely-missing id is a 404; anything else (a DB outage, etc.) should surface as 500,
		// not be mislabeled "not found".
		if (err instanceof APIError && err.statusCode === 404) error(404, 'Operator not found');
		throw err;
	}

	const { sessions } = await auth.api.listUserSessions({
		body: { userId: params.id },
		headers: request.headers
	});

	return {
		target,
		// Project to only the fields the page renders — listUserSessions returns the raw session rows,
		// which include the session `token`; never ship an operator's session tokens to the client.
		sessions: sessions.map((s) => ({
			id: s.id,
			createdAt: s.createdAt,
			expiresAt: s.expiresAt,
			ipAddress: s.ipAddress ?? null
		})),
		isSelf: params.id === meId,
		isOwner: owners.includes(params.id),
		// The account can be role-changed / disabled / reset / force-logged-out / deleted only when
		// it's neither yours nor an owner's. Drives which controls the detail page renders.
		manageable: params.id !== meId && !owners.includes(params.id)
	};
};

// Every action authorizes itself with `rosterAdmin(locals)` — SvelteKit does NOT run the layout
// guard before a form action (only on the re-render), so the route guard alone wouldn't protect
// these. `[id]` guarantees params.id at runtime, but contextual typing through the `Actions` Record
// doesn't narrow it (unlike `load`), so it types as `string | undefined` — assert it per action.
// (Both `rosterAdmin` and `guardTarget` read env, so they run before the first await.)
export const actions: Actions = {
	// Edit name + email. Allowed on any account (non-destructive) — email is the sign-in identity.
	updateDetails: async ({ params, request, locals }) => {
		const userId = params.id!;
		if (!rosterAdmin(locals)) return fail(403, { scope: 'details', error: 'forbidden' });
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

	// Change role (admin / operator / user). Blocked on self + owner.
	setRole: async ({ params, request, locals }) => {
		const userId = params.id!;
		const me = rosterAdmin(locals);
		if (!me) return fail(403, { scope: 'role', error: 'forbidden' });
		const blocked = guardTarget(userId, me.id);
		if (blocked) return fail(403, { scope: 'role', error: blocked });
		const auth = getAuth();
		const data = await request.formData();
		const role = coerceRole(data.get('role'), 'operator');
		try {
			await auth.api.setRole({ body: { userId, role: apiRole(role) }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'role', error: adminErrorCode(err) });
		}
		return { scope: 'role', ok: true };
	},

	// Set a new password (the admin shares it out-of-band). Blocked on self + owner.
	resetPassword: async ({ params, request, locals }) => {
		const userId = params.id!;
		const me = rosterAdmin(locals);
		if (!me) return fail(403, { scope: 'password', error: 'forbidden' });
		const blocked = guardTarget(userId, me.id);
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
		const me = rosterAdmin(locals);
		if (!me) return fail(403, { scope: 'session', error: 'forbidden' });
		const blocked = guardTarget(userId, me.id);
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
		const me = rosterAdmin(locals);
		if (!me) return fail(403, { scope: 'status', error: 'forbidden' });
		const blocked = guardTarget(userId, me.id);
		if (blocked) return fail(403, { scope: 'status', error: blocked });
		const auth = getAuth();
		try {
			await auth.api.banUser({ body: { userId }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'status', error: adminErrorCode(err) });
		}
		return { scope: 'status', ok: true };
	},

	// Lift a disable. Safe to run on anyone (only restores access), so it skips the self/owner guard
	// — but still admin-only.
	enable: async ({ params, request, locals }) => {
		const userId = params.id!;
		if (!rosterAdmin(locals)) return fail(403, { scope: 'status', error: 'forbidden' });
		const auth = getAuth();
		try {
			await auth.api.unbanUser({ body: { userId }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'status', error: adminErrorCode(err) });
		}
		return { scope: 'status', ok: true };
	},

	// Permanent hard delete (cascades sessions/accounts). Blocked on self + owner (the plugin also
	// blocks self-remove) and gated by the "I understand" checkbox. Redirects back to the roster.
	delete: async ({ params, request, locals }) => {
		const userId = params.id!;
		const me = rosterAdmin(locals);
		if (!me) return fail(403, { scope: 'delete', error: 'forbidden' });
		const blocked = guardTarget(userId, me.id);
		if (blocked) return fail(403, { scope: 'delete', error: blocked });
		const auth = getAuth();
		const data = await request.formData();
		if (data.get('confirm') !== 'on') return fail(400, { scope: 'delete', error: 'generic' });
		try {
			await auth.api.removeUser({ body: { userId }, headers: request.headers });
		} catch (err) {
			return fail(400, { scope: 'delete', error: adminErrorCode(err) });
		}
		redirect(303, '/admin/users');
	}
};
