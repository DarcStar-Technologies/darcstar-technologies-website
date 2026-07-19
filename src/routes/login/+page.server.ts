import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Admin login (#69). Sign-in itself happens client-side (see +page.svelte / auth-client.ts) so the
// request traverses Better Auth's rate limiter; this server load only handles the already-signed-in
// case. `hooks.server.ts` populates locals.user for /login.
export const load: PageServerLoad = ({ locals }) => {
	// An operator who is already signed in never needs the form — send them to the admin.
	if (locals.user) redirect(303, '/admin');
	return {};
};
