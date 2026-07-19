import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Route guard for the gated admin area (#69). `hooks.server.ts` resolves the Better Auth session
// into `locals.user` for `/admin/*`; this layout simply enforces it, so every page under /admin
// inherits the guard. An unauthenticated visitor is bounced to the login page.
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: locals.user };
};
