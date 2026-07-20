import type { LayoutServerLoad } from './$types';

// Site-wide auth snapshot for the UI. `hooks.server.ts` resolves the Better Auth session into
// `locals.user` whenever the request carries a session cookie (anonymous visitors skip the lookup
// — the #48 win), so this exposes just what shared UI needs: the navbar swaps "Sign in" for the
// Admin/Sign-out controls when `user` is present. Return a minimal shape (email only), never the
// whole `User` — `locals.user` stays server-only. `null` (not `undefined`) → explicit "signed out".
export const load: LayoutServerLoad = ({ locals }) => {
	return { user: locals.user ? { email: locals.user.email } : null };
};
