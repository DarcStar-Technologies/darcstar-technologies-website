import { isStaff } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';
import type { LayoutServerLoad } from './$types';

// Site-wide auth snapshot for the UI. `hooks.server.ts` resolves the Better Auth session into
// `locals.user` whenever the request carries a session cookie (anonymous visitors skip the lookup
// — the #48 win), so this exposes just what shared UI needs: the navbar swaps "Sign in" for the
// signed-in controls when `user` is present. `isStaff` splits those controls — staff (admin/operator)
// get the "Admin" link, an end-user (#96) gets "Account". It's a SEPARATE key (not nested in `user`)
// so the admin/account layouts, which override `user` with their own page data, can't shadow it.
// Return a minimal `user` (email only), never the whole `User` — `locals.user` stays server-only.
// `user: null` (not `undefined`) → explicit "signed out".
export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user ? { email: locals.user.email } : null,
		isStaff: isStaff(locals.user, readEnv('ADMIN_USER_IDS'))
	};
};
