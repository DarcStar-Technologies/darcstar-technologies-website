import { fail, redirect, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

// Password-reset request (step 1). Mirrors the /login + /signup form-action pattern: a native POST
// forwards to Better Auth's HANDLER (so it rides the router's DB-backed rate limiter). Better Auth's
// `request-password-reset` is ALREADY anti-enumerating — it simulates the token path for an unknown
// email and returns an identical `{ status: true }` (password.mjs) — and is OUTSIDE the captcha scope,
// so this works no-JS. We keep the client outcome uniform to match: any non-429 → the same generic
// "check your email", so the form never reveals whether an account exists for the address.
//
// Single `default` action ONLY — do NOT add a named action beside it (SvelteKit's
// check_named_default_separate 500s every POST if a page mixes default + named; see #122).

export const load: PageServerLoad = ({ locals }) => {
	// A signed-in visitor changes their password from /account, not here.
	if (locals.user) redirect(303, '/account');
	return {};
};

export const actions: Actions = {
	default: async ({ request, url, locals, getClientAddress }) => {
		if (locals.user) redirect(303, '/account');
		// getAuth() reads platform.env via getRequestEvent(); resolve it before the first await.
		const auth = getAuth();

		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		if (!email) return fail(400, { email: '', error: 'missing' as const });

		// Forward the client IP so the rate limiter keys per-IP (default header: x-forwarded-for).
		const headers = new Headers({ 'content-type': 'application/json' });
		try {
			const ip = getClientAddress();
			if (ip) headers.set('x-forwarded-for', ip);
		} catch {
			// adapter couldn't resolve an address
		}

		const res = await auth.handler(
			new Request(new URL('/api/auth/request-password-reset', url.origin), {
				method: 'POST',
				headers,
				// redirectTo is where Better Auth's GET /reset-password/:token callback lands the user after
				// validating the token: /reset-password?token=… (valid) or ?error=INVALID_TOKEN. Must be
				// same-origin (the endpoint's originCheck); a relative path satisfies that.
				body: JSON.stringify({ email, redirectTo: '/reset-password' })
			})
		);

		if (res.status === 429) return fail(429, { email, error: 'ratelimited' as const });
		// Every other outcome — including a rare Resend/infra failure — resolves to the same generic
		// confirmation, so response + status never leak whether the address has an account.
		return { ok: true as const, email };
	}
};
