import { redirect } from '@sveltejs/kit';
import { isRosterAdmin, isStaff } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';
import type { LayoutServerLoad } from './$types';

// Route guard for the gated admin area (#69). `hooks.server.ts` resolves the Better Auth session
// into `locals.user` for `/admin/*`; this layout enforces it, so every page under /admin inherits
// the guard. An unauthenticated visitor is bounced to the login page.
//
// Staff-only (#95): an `admin` or `operator` may triage messages here. A signed-in `user` (end-user,
// #96) has no admin surface, so it's bounced to its OWN home — `/account`, not the marketing site.
// This is also the landing for an end-user who signs in via /login (that action 303s to /admin), so
// self-registered users (#96 PR2) reach their portal instead of the homepage. The `/admin` gate is a
// real role check now, not merely "is signed in".
//
// `isAdmin` further gates the roster-management UI (the "Users" nav tab + /admin/users): true for
// the `admin` role or an ADMIN_USER_IDS-allowlisted owner. It's a UX gate only — the Better Auth
// admin endpoints re-check authoritatively (bypassing the session cookie-cache) on every call.
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const adminUserIds = readEnv('ADMIN_USER_IDS');
	if (!isStaff(locals.user, adminUserIds)) redirect(303, '/account');
	return {
		user: locals.user,
		isAdmin: isRosterAdmin(locals.user, adminUserIds)
	};
};
