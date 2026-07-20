import { redirect } from '@sveltejs/kit';
import { isRosterAdmin } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';
import type { LayoutServerLoad } from './$types';

// Route guard for the gated admin area (#69). `hooks.server.ts` resolves the Better Auth session
// into `locals.user` for `/admin/*`; this layout enforces it, so every page under /admin inherits
// the guard. An unauthenticated visitor is bounced to the login page.
//
// `isAdmin` gates the roster-management UI (the "Users" nav tab + /admin/users): true for the
// `admin` role or an ADMIN_USER_IDS-allowlisted owner. It's a UX gate only — the Better Auth admin
// endpoints re-check authoritatively (bypassing the session cookie-cache) on every call.
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return {
		user: locals.user,
		isAdmin: isRosterAdmin(locals.user, readEnv('ADMIN_USER_IDS'))
	};
};
