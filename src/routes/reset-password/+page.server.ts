import { fail, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

// Password-reset (step 2 — the emailed link lands here). Better Auth's GET /reset-password/:token
// validates the token, then redirects here with `?token=…` (valid) or `?error=INVALID_TOKEN`
// (invalid / expired / already used). `load` reads that; the form POSTs { newPassword, token } to the
// handler's /reset-password (which rides the rate limiter and, on success, revokes the user's other
// sessions — see auth.ts `revokeSessionsOnPasswordReset`). Works no-JS; not captcha-scoped.
//
// Single `default` action ONLY — do NOT add a named action beside it (SvelteKit's
// check_named_default_separate 500s every POST if a page mixes default + named; see #122).

export const load: PageServerLoad = ({ url }) => {
	const token = url.searchParams.get('token');
	// The GET callback appends `?error=INVALID_TOKEN` for a bad/expired/used link; a missing token
	// means someone hit /reset-password directly. Either way there's no usable token → show the
	// "invalid link" state, not a password form that can't succeed.
	const invalid = !token || url.searchParams.has('error');
	return { token: token ?? null, invalid };
};

export const actions: Actions = {
	default: async ({ request, url, getClientAddress }) => {
		// getAuth() reads platform.env via getRequestEvent(); resolve it before the first await.
		const auth = getAuth();

		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		// The token rides in a hidden field (seeded from the load), so the action never depends on the
		// request URL keeping its query string across a no-JS re-render.
		const token = String(data.get('token') ?? '');

		// Echo the token back on recoverable failures so the retry keeps it (no-JS re-render safety).
		if (!password) return fail(400, { error: 'missing' as const, token });
		if (password.length < 8) return fail(400, { error: 'password_short' as const, token });
		if (!token) return fail(400, { error: 'invalid_token' as const });

		const headers = new Headers({ 'content-type': 'application/json' });
		try {
			const ip = getClientAddress();
			if (ip) headers.set('x-forwarded-for', ip);
		} catch {
			// adapter couldn't resolve an address
		}

		const res = await auth.handler(
			new Request(new URL('/api/auth/reset-password', url.origin), {
				method: 'POST',
				headers,
				body: JSON.stringify({ newPassword: password, token })
			})
		);

		// Success: the password is changed and the user's other sessions are revoked. They are NOT
		// signed in here (this is an anonymous, token-based flow), so send them to sign in anew.
		if (res.ok) return { ok: true as const };
		if (res.status === 429) return fail(429, { error: 'ratelimited' as const, token });
		// The remaining failure is an invalid/expired/already-consumed token (better-auth 400
		// INVALID_TOKEN; PASSWORD_TOO_SHORT is caught above). Flip to the "invalid link" state, which
		// points back to /forgot-password for a fresh link.
		return fail(400, { error: 'invalid_token' as const });
	}
};
