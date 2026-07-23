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

// Forward the caller's IP so the rate limiter keys per-IP (default header: x-forwarded-for) instead
// of sharing one NO_TRUSTED_IP bucket. On Cloudflare getClientAddress() is cf-connecting-ip (present
// in prod, unspoofable); it can be null/throw on other adapters — then omit and dev falls back to a
// localhost key. Shared by both actions.
function clientIpHeaders(getClientAddress: () => string): Headers {
	const headers = new Headers({ 'content-type': 'application/json' });
	try {
		const ip = getClientAddress();
		if (ip) headers.set('x-forwarded-for', ip);
	} catch {
		// adapter couldn't resolve an address
	}
	return headers;
}

// NOTE: every action here MUST be named (no `default`). SvelteKit forbids a `default` action
// coexisting with named actions — `check_named_default_separate` 500s EVERY POST to the page,
// not just the default one (regression fixed after #119/#121 shipped a `resend` beside `default`).
export const actions: Actions = {
	signup: async ({ request, url, locals, getClientAddress }) => {
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
		const headers = clientIpHeaders(getClientAddress);
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
	},

	// #115: resend the verification link. The dead-end this fixes: an unverified account that signs up
	// AGAIN hits better-auth's anti-enumeration path (a generic "check your email" with NO email sent),
	// and can't sign in either — so the "check your email" panel offers this. Forwards to better-auth's
	// POST /send-verification-email, which is ALREADY anti-enumerating: constant-time (500ms floor) and
	// an identical `{ status: true }` whether the address is unverified/verified/absent — it only mails
	// an existing UNVERIFIED account. So we keep the client outcome uniform too: any non-429 → the same
	// neutral "if it needs verifying, a link is on its way" confirmation, never "sent"/"no such account".
	// It's OUTSIDE the captcha scope (endpoints: ['/sign-up/email']), so no widget/token is needed —
	// this action works with or without JS. `ok: true` is kept in every return so the panel stays put
	// (the page renders it on `form?.ok`) rather than flipping back to the sign-up form.
	resend: async ({ request, url, locals, getClientAddress }) => {
		if (locals.user) redirect(303, '/account');
		const auth = getAuth();

		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		// The hidden field is bound to form.email, so this is unreachable via the UI; a hand-crafted
		// empty POST just gets the same neutral confirmation (the correct non-enumerating answer).
		if (!email) return { ok: true as const, email: '', resend: 'sent' as const };

		const res = await auth.handler(
			new Request(new URL('/api/auth/send-verification-email', url.origin), {
				method: 'POST',
				headers: clientIpHeaders(getClientAddress),
				// Match the sign-up callback so the fresh link also lands the verified user on /account.
				body: JSON.stringify({ email, callbackURL: '/account' })
			})
		);

		if (res.status === 429)
			return fail(429, { ok: true as const, email, resend: 'ratelimited' as const });
		// Every other outcome resolves to the same neutral confirmation — including a rare Resend/infra
		// 500 (which only the unverified-existing branch can even reach), so status never leaks existence.
		return { ok: true as const, email, resend: 'sent' as const };
	}
};
