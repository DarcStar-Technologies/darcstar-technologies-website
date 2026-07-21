import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// End-user account portal (#96). Gated to ANY signed-in account — unlike /admin, there's no `isStaff`
// check: a `user` (end-user) is exactly who /admin bounces, and this is their home. Staff can reach
// it too (it just shows their own data), but the navbar points them at /admin instead.
//
// SvelteKit does NOT run this guard before a form action (only on the re-render), so each action in
// +page.server.ts self-authorizes with `locals.user`; this guard covers page loads. `hooks.server.ts`
// lists `/account` in SESSION_PREFIXES, so `locals.user` resolves here even without the cookie path.
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// Top-level `email`/`name` (NOT nested under `user`): `App.PageData.user` is the navbar's
	// `{ email }` shape, so returning a richer `user` here would clash with it. These plain keys are
	// this account's own display fields for the portal shell + profile form.
	return { email: locals.user.email, name: locals.user.name };
};
