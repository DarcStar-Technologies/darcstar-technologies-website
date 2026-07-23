import { fail, redirect, type Actions, type Cookies } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { logLoginAttempt } from '$lib/server/auth-audit';
import { persistLoginAudit } from '$lib/server/login-audit-store';
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

// NOTE: every action here MUST be named (no `default`). SvelteKit forbids a `default` action
// coexisting with named actions — `check_named_default_separate` 500s EVERY POST to the page,
// not just the default one (regression fixed after #121 added `resend` beside `default`). The
// shared LoginForm posts to `?/signin`; `scripts/smoke-signin.mjs` posts there too.
export const actions: Actions = {
	signin: async ({ request, cookies, url, locals, getClientAddress }) => {
		if (locals.user) redirect(303, '/admin');
		// getAuth() reads platform.env via getRequestEvent(); resolve it before the first await.
		const auth = getAuth();

		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		const password = String(data.get('password') ?? '');
		// Repopulate `email` on failure, never the password. A single generic `error` covers wrong
		// password / unknown account / empty alike — the UI shows one message, so the form can't be
		// used to enumerate accounts.
		if (!email || !password) return fail(400, { email, error: 'invalid' as const });

		// A clean sub-request: no cookie/origin headers (Better Auth's origin check only validates
		// when a cookie is present, so this passes in every environment; calling handler() directly
		// rather than via svelteKitHandler also sidesteps the isAuthPath origin gate). But DO forward
		// the client IP — Better Auth's rate limiter keys by it (default header: x-forwarded-for), and
		// without it every sign-in would share one NO_TRUSTED_IP bucket (a global lockout vector).
		// getClientAddress() resolves Cloudflare's cf-connecting-ip, which the client can't spoof.
		const headers = new Headers({ 'content-type': 'application/json' });
		// On Cloudflare, getClientAddress() returns cf-connecting-ip (always present in prod); it can
		// return null (or throw on other adapters) when unresolvable — then we omit the header and
		// Better Auth falls back to a localhost rate-limit key in dev.
		let clientIp: string | null = null;
		try {
			clientIp = getClientAddress();
		} catch {
			// adapter couldn't resolve an address
		}
		if (clientIp) headers.set('x-forwarded-for', clientIp);

		const res = await auth.handler(
			new Request(new URL('/api/auth/sign-in/email', url.origin), {
				method: 'POST',
				headers,
				body: JSON.stringify({ email, password })
			})
		);

		if (res.status === 429) {
			// Rate-limit hits are the one sign-in outcome the Better Auth after-hook can't see: the
			// router rejects them in onRequest, before endpoint dispatch, so record them here where we
			// still hold the email + client IP. Every other outcome (bad creds / banned / success) flows
			// through the hook (auth-audit.ts), so this is the only place 429s are audited — no dupes.
			const record = {
				email,
				userId: null,
				success: false,
				reason: 'rate_limited',
				status: 429,
				ipAddress: clientIp,
				userAgent: request.headers.get('user-agent') ?? null
			};
			logLoginAttempt(record);
			persistLoginAudit(record);
			return fail(429, { email, error: 'ratelimited' as const });
		}
		if (!res.ok) {
			// A 403 EMAIL_NOT_VERIFIED (#96 PR2) is the ONE non-success we surface distinctly: it fires
			// only AFTER the password check passes (sign-in.mjs), so revealing it leaks nothing to a
			// password-less enumerator — a wrong password / unknown account still returns the generic
			// 'invalid' below. `sendOnSignIn` (auth.ts) has just re-mailed a fresh verification link, so
			// the message points the user at their inbox. Other 403s (e.g. banned) stay generic.
			if (res.status === 403) {
				const body = (await res.json().catch(() => null)) as { code?: string } | null;
				if (body?.code === 'EMAIL_NOT_VERIFIED') {
					return fail(403, { email, error: 'unverified' as const });
				}
			}
			return fail(400, { email, error: 'invalid' as const });
		}

		// Outside any try: redirect() throws its own control-flow signal. The cookies set above ride
		// along on the 303 response.
		forwardSetCookies(cookies, res);
		redirect(303, '/admin');
	},

	// #115: resend the verification link from the login form's "verify your email" state. A user who
	// tries to sign in with an UNVERIFIED account sees the distinct 'unverified' message above (and
	// `sendOnSignIn` has already re-mailed once); this gives them an explicit way to request another —
	// without re-entering their password. Forwards to Better Auth's POST /send-verification-email,
	// which is ALREADY anti-enumerating: a constant-time floor + an identical `{ status: true }`
	// whether the address is unverified / verified / absent, mailing only a real unverified account
	// (see signup/+page.server.ts + the auth.spec.ts pins). We keep the client outcome uniform to
	// match: any non-429 → the same neutral confirmation, never revealing whether the address exists.
	// Outside the captcha scope, so no widget/token needed. Not audited (it isn't a sign-in attempt);
	// shares the '/send-verification-email' rate-limit rule (auth-options.ts).
	resend: async ({ request, url, locals, getClientAddress }) => {
		if (locals.user) redirect(303, '/admin');
		// getAuth() reads platform.env via getRequestEvent(); resolve it before the first await.
		const auth = getAuth();

		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		// No email to resend to (empty field) — return the same neutral confirmation (the correct
		// non-enumerating answer), don't 500.
		if (!email) return { resent: 'sent' as const };

		// Forward the client IP so the rate limiter keys per-IP (same rationale as the sign-in path).
		const headers = new Headers({ 'content-type': 'application/json' });
		try {
			const ip = getClientAddress();
			if (ip) headers.set('x-forwarded-for', ip);
		} catch {
			// adapter couldn't resolve an address
		}

		const res = await auth.handler(
			new Request(new URL('/api/auth/send-verification-email', url.origin), {
				method: 'POST',
				headers,
				// callbackURL lands the freshly-verified (auto-signed-in) user on their portal.
				body: JSON.stringify({ email, callbackURL: '/account' })
			})
		);

		if (res.status === 429) return fail(429, { resent: 'ratelimited' as const });
		// Every other outcome → the same neutral confirmation (status never leaks existence).
		return { resent: 'sent' as const };
	}
};
