import { fail, redirect, type Actions } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { readEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

// Public sign-up (#96 PR 2). Mirrors the /login form-action pattern (login/+page.server.ts): a native
// POST forwards to Better Auth's HANDLER (not a direct auth.api call) so it rides the router's
// DB-backed rate limiter AND the Turnstile captcha plugin's onRequest gate — both live in the router,
// which a direct api call would skip. `requireEmailVerification` is on (auth-options.ts), so a
// successful sign-up creates an UNVERIFIED account, mails the verification link (auth.ts), and does
// NOT sign the visitor in — the page shows "check your email". Duplicate emails return the same
// generic 200 (better-auth genericizes them under requireEmailVerification), so the form never reveals
// whether an address is already registered.
//
// NOTE: sign-up REQUIRES JS in production — Cloudflare Turnstile has no no-JS path. This is the one
// accepted deviation from the no-JS /login + /contact flows (Turnstile was the chosen bot control).

export const load: PageServerLoad = ({ locals }) => {
	// A signed-in visitor never needs to register — send them to their portal (/account also admits
	// staff). hooks.server.ts resolves locals.user here whenever a session cookie is present.
	if (locals.user) redirect(303, '/account');
	// Render the widget ONLY when BOTH Turnstile keys are set — the exact condition under which the
	// captcha plugin enforces (auth.ts `captchaActive`). This keeps "widget shown" ⟺ "captcha
	// enforced": a half-config (only one key) shows no widget AND isn't enforced, so sign-up still
	// works instead of dead-ending (secret-only would otherwise require a token with no widget to mint
	// it) or fail-opening (site-key-only would show a widget the server ignores). The secret is read
	// here purely as a boolean and never returned, so it isn't exposed to the client.
	const siteKey = readEnv('TURNSTILE_SITE_KEY');
	const active = Boolean(siteKey && readEnv('TURNSTILE_SECRET_KEY'));
	return { turnstileSiteKey: active ? (siteKey ?? null) : null };
};

// better-auth captcha plugin error codes (plugins/captcha/error-codes.ts) — an absent/failed challenge.
const CAPTCHA_ERROR_CODES = new Set(['MISSING_RESPONSE', 'VERIFICATION_FAILED', 'UNKNOWN_ERROR']);

export const actions: Actions = {
	default: async ({ request, url, locals, getClientAddress }) => {
		if (locals.user) redirect(303, '/account');
		// getAuth() reads platform.env via getRequestEvent(); resolve it before the first await.
		const auth = getAuth();

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const email = String(data.get('email') ?? '').trim();
		const password = String(data.get('password') ?? '');
		// Turnstile injects this hidden field into the widget container once the challenge is solved.
		const captchaToken = String(data.get('cf-turnstile-response') ?? '');
		// Repopulate name + email on failure, never the password.
		const values = { name, email };

		if (!name || !email || !password) return fail(400, { values, error: 'missing' as const });
		if (password.length < 8) return fail(400, { values, error: 'password_short' as const });

		// A clean sub-request through the handler (see login/+page.server.ts for why handler, not api).
		// Forward the client IP for the rate limiter (keyed on x-forwarded-for), and the Turnstile
		// token as x-captcha-response — the header the captcha plugin reads.
		const headers = new Headers({ 'content-type': 'application/json' });
		let clientIp: string | null = null;
		try {
			clientIp = getClientAddress();
		} catch {
			// adapter couldn't resolve an address
		}
		if (clientIp) headers.set('x-forwarded-for', clientIp);
		if (captchaToken) headers.set('x-captcha-response', captchaToken);

		const res = await auth.handler(
			new Request(new URL('/api/auth/sign-up/email', url.origin), {
				method: 'POST',
				headers,
				// callbackURL is where /verify-email lands the freshly-verified (auto-signed-in) user.
				body: JSON.stringify({ name, email, password, callbackURL: '/account' })
			})
		);

		// Success — including the generic duplicate response. No session is set under
		// requireEmailVerification, so there are no cookies to forward: the visitor isn't signed in
		// yet, they must click the emailed link. Show "check your email".
		if (res.ok) return { ok: true as const, email };

		if (res.status === 429) return fail(429, { values, error: 'ratelimited' as const });

		// Map a captcha rejection to its own message; everything else is one generic, non-enumerating
		// error. Parse the body once (it was not consumed above).
		const body = (await res.json().catch(() => null)) as { code?: string } | null;
		const error = body?.code && CAPTCHA_ERROR_CODES.has(body.code) ? 'captcha' : 'generic';
		return fail(400, { values, error });
	}
};
