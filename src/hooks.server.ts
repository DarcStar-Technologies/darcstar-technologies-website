import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { getAuth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
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

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	// Better Auth is wired but not used by any page yet: no sign-in UI, and nothing reads
	// locals.user/session (that ships with the gated area, #69). Confine the whole surface to
	// /api/auth/* so ordinary page views don't pay a session lookup each request and the auth
	// API can't touch the rest of the app. Sign-up itself is disabled in auth.ts (#48). Grow
	// this prefix to cover protected routes when they land. `event.url` is the original request
	// path (handleParaglide reassigns event.request, not event.url), so the match is exact.
	if (!event.url.pathname.startsWith(AUTH_API_PREFIX)) return resolve(event);

	const auth = getAuth();
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handleParaglide, handleBetterAuth);
