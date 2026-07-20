import { fail, redirect, type Actions, type Cookies } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

// Admin login (#69). Sign-in is a server form action, so it works WITHOUT JS — a native POST signs
// in and 303-redirects to /admin (progressively enhanced with use:enhance in LoginForm). It routes
// through Better Auth's HANDLER rather than a direct `auth.api.signInEmail` call: rate limiting
// lives in Better Auth's router (its onRequest), so a direct api call would skip the router and the
// limiter with it. `hooks.server.ts` populates locals.user for /login.

export const load: PageServerLoad = ({ locals }) => {
	// An operator who is already signed in never needs the form — send them to the admin.
	if (locals.user) redirect(303, '/admin');
	return {};
};

// Copy the session Set-Cookie(s) from Better Auth's response onto the SvelteKit response. The
// router path does NOT run the sveltekitCookies plugin's event-cookie setter (that fires only for
// direct auth.api calls), so we forward them ourselves. `encode: (v) => v` — the value is already
// URL-encoded by Better Auth; re-encoding it would corrupt the token.
function forwardSetCookies(cookies: Cookies, res: Response): void {
	for (const raw of res.headers.getSetCookie()) {
		const [nameValue, ...attrs] = raw.split(';');
		const eq = nameValue.indexOf('=');
		if (eq === -1) continue;
		const name = nameValue.slice(0, eq).trim();
		const value = nameValue.slice(eq + 1).trim();
		const opts: Parameters<Cookies['set']>[2] = { path: '/', encode: (v) => v };
		for (const attr of attrs) {
			const [k, ...rest] = attr.split('=');
			const key = k.trim().toLowerCase();
			const v = rest.join('=').trim();
			if (key === 'path') opts.path = v;
			else if (key === 'domain') opts.domain = v;
			else if (key === 'max-age') opts.maxAge = Number(v);
			else if (key === 'expires') opts.expires = new Date(v);
			else if (key === 'samesite') opts.sameSite = v.toLowerCase() as 'lax' | 'strict' | 'none';
			else if (key === 'httponly') opts.httpOnly = true;
			else if (key === 'secure') opts.secure = true;
		}
		cookies.set(name, value, opts);
	}
}

export const actions: Actions = {
	default: async ({ request, cookies, url, locals }) => {
		if (locals.user) redirect(303, '/admin');

		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		const password = String(data.get('password') ?? '');
		// Repopulate `email` on failure, never the password. A single generic `error` covers wrong
		// password / unknown account / empty alike — the UI shows one message, so the form can't be
		// used to enumerate accounts.
		if (!email || !password) return fail(400, { email, error: 'invalid' as const });

		// A clean sub-request (no cookie/origin headers): Better Auth's origin check only validates
		// when a cookie is present, so this passes in every environment, and calling handler()
		// directly (not via svelteKitHandler) sidesteps the isAuthPath origin gate entirely.
		const res = await getAuth().handler(
			new Request(new URL('/api/auth/sign-in/email', url.origin), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, password })
			})
		);

		if (res.status === 429) return fail(429, { email, error: 'ratelimited' as const });
		if (!res.ok) return fail(400, { email, error: 'invalid' as const });

		// Outside any try: redirect() throws its own control-flow signal. The cookies set above ride
		// along on the 303 response.
		forwardSetCookies(cookies, res);
		redirect(303, '/admin');
	}
};
