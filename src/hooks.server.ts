import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { getAuth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
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
// Paths whose server `load` functions read `locals.user`: Better Auth's own API, plus the #69
// gated area (`/admin`) and the login page (which redirects an already-signed-in operator away).
// Every OTHER path skips the session lookup entirely — that's the #48 win (no per-view auth cost
// on marketing/contact pages), preserved.
const SESSION_PREFIXES = [AUTH_API_PREFIX, '/admin', '/login'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	// Match on the DE-LOCALIZED path: the site localizes URLs as `/es/*` (paraglide `url`
	// strategy). `reroute` (src/hooks.ts) canonicalizes for routing, but `event.url` here is still
	// the raw request path, so `/es/admin` must be normalized to `/admin` before matching.
	const path = deLocalizeUrl(event.url).pathname;
	const needsSession = SESSION_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
	if (!needsSession) return resolve(event);

	const auth = getAuth();
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	// Only Better Auth's own endpoints are mounted through its handler; `/admin` and `/login` are
	// ordinary SvelteKit routes that simply read the `locals` populated above. Sign-up stays
	// disabled in auth.ts (#48); the auth surface can still only touch its own namespace.
	if (path.startsWith(AUTH_API_PREFIX)) {
		return svelteKitHandler({ event, resolve, auth, building });
	}
	return resolve(event);
};

export const handle: Handle = sequence(handleParaglide, handleBetterAuth);
