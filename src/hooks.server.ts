import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { getAuth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getSessionCookie } from 'better-auth/cookies';
import type { Handle } from '@sveltejs/kit';
import { deLocalizeUrl, getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

// Better Auth's default basePath — the entire auth API + session cookies live under it.
const AUTH_API_PREFIX = '/api/auth';
// Paths whose server `load` functions unconditionally read `locals.user`: Better Auth's own API,
// the #69 gated area (`/admin`), the login page (which redirects an already-signed-in operator
// away), and the #96 end-user portal (`/account`, gated to signed-in accounts). Requests here always
// resolve the session, even if the cookie is somehow absent.
const SESSION_PREFIXES = [AUTH_API_PREFIX, '/admin', '/login', '/account'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	// Match on the DE-LOCALIZED path: the site localizes URLs as `/es/*` (paraglide `url`
	// strategy). `reroute` (src/hooks.ts) canonicalizes for routing, but `event.url` here is still
	// the raw request path, so `/es/admin` must be normalized to `/admin` before matching.
	const path = deLocalizeUrl(event.url).pathname;
	// Resolve the session on the auth-owned prefixes above, OR on ANY request that carries a Better
	// Auth session cookie — so the navbar can reflect sign-in state site-wide (root +layout.server.ts
	// → page.data.user). `getSessionCookie` is a header-only cookie read (no DB, no auth instance):
	// anonymous visitors (no cookie = the common case) still skip the lookup entirely — the #48 win,
	// preserved for the traffic that matters. Cookie presence only GATES the lookup; the real
	// getSession below still validates, so a forged cookie grants nothing (locals.user stays unset).
	const isAuthOwnedPath = SESSION_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
	const needsSession = isAuthOwnedPath || getSessionCookie(event.request) !== null;
	if (!needsSession) return resolve(event);

	const auth = getAuth();
	const session = await auth.api.getSession({
		headers: event.request.headers,
		// Resolve AUTHORITATIVELY (a DB read, bypassing the session_data cookie-cache) on the auth-owned
		// surfaces (/admin, /login, /api/auth/*): an admin's roster force-logout / disable deletes the
		// target's session server-side, and this makes that bite on the target's very NEXT request here
		// — instead of lingering up to `cookieCache.maxAge` (see auth-options.ts). Cookie-only requests
		// (the site-wide navbar reflection on ordinary pages) keep the cached path — the #88 perf win,
		// where a stale "signed in" snapshot is only cosmetic (clicking through to /admin re-checks).
		query: isAuthOwnedPath ? { disableCookieCache: true } : undefined
	});

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	// Only Better Auth's own endpoints are mounted through its handler; every other route (the admin
	// area, login, sign-up, or any cookie-bearing page view) is an ordinary SvelteKit route that just
	// reads the `locals` populated above. Public sign-up is now open but gated (Turnstile +
	// requireEmailVerification, #96 PR2); the auth surface still only touches its own namespace.
	if (path === AUTH_API_PREFIX || path.startsWith(AUTH_API_PREFIX + '/')) {
		return svelteKitHandler({ event, resolve, auth, building });
	}
	return resolve(event);
};

export const handle: Handle = sequence(handleParaglide, handleBetterAuth);
