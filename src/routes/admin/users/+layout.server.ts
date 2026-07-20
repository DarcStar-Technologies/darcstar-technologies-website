import { redirect } from '@sveltejs/kit';
import { isRosterAdmin } from '$lib/server/admin-access';
import { readEnv } from '$lib/server/env';
import type { LayoutServerLoad } from './$types';

// Roster management is admin-only. The parent /admin guard already required a signed-in operator;
// this narrows to roster admins (the `admin` role or an ADMIN_USER_IDS-allowlisted owner). A
// signed-in but non-admin operator is bounced back to the submissions view. Defense-in-depth only:
// every Better Auth admin endpoint re-checks authorization authoritatively.
export const load: LayoutServerLoad = ({ locals }) => {
	if (!isRosterAdmin(locals.user, readEnv('ADMIN_USER_IDS'))) redirect(303, '/admin');
};
