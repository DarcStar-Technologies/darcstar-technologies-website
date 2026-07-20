import { redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// Global sign-out target for the navbar "Sign out" form — reachable from any page, no JS required
// (a native form POST). Clears the Better Auth session cookie via the sveltekitCookies plugin (the
// same `api.signOut` path /admin's signout action uses), then lands on the marketing home page.
export const POST: RequestHandler = async ({ request }) => {
	// getAuth() reads platform.env via getRequestEvent(), so it must run before the first await.
	await getAuth().api.signOut({ headers: request.headers });
	redirect(303, '/');
};

// A stray GET (someone types /logout) has nothing to render — send them home.
export const GET: RequestHandler = () => redirect(303, '/');
