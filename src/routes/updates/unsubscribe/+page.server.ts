import type { Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { waitlistSigningSecret } from '$lib/server/waitlist-secret';
import { runUpdatesAction } from '$lib/server/waitlist-updates-action';
import { unsubscribeUpdates } from '$lib/server/waitlist-store';
import { verifyUpdatesUnsubscribeToken } from '$lib/server/waitlist-updates-token';
import type { PageServerLoad } from './$types';

// The login-free unsubscribe /privacy promises (DAR-139), reached by the `u1` link every message
// carries — including the confirmation request itself, which is the only message this site sends about
// updates today and the one somebody whose address a stranger typed in will actually receive.
//
// NO AUTHENTICATION, BY DESIGN AND BY PROMISE. The token is the whole authorization, and it needs to
// be: requiring an account would make the escape hatch unreachable for the people most likely to want
// it. It authorizes only a removal, which is why its TTL is a year where the confirmation link's is a
// week (waitlist-updates-token.ts).
//
// A POST here too. RFC 8058 made one-click unsubscribe a POST for a concrete reason — GET prefetching
// unsubscribed people who had not asked to be — and this site has its own instance of that trap on
// record (DAR-75: `<body>` sets `preload-data="hover"`, so a destructive GET behind an internal link
// fired on mouse-over). The landing page is one button.
//
// Single `default` action ONLY — never a named action beside it (#122).

export const load: PageServerLoad = async ({ url }) => {
	const secret = waitlistSigningSecret();
	const token = url.searchParams.get('token') ?? '';
	const invalid = !secret || (await verifyUpdatesUnsubscribeToken(secret, token)) === null;
	return { token, invalid };
};

export const actions: Actions = {
	default: async ({ request }) => {
		// Request-scoped env: both read before the first await.
		const db = getDb();
		const secret = waitlistSigningSecret();

		const data = await request.formData();
		const token = String(data.get('token') ?? '');

		const result = await runUpdatesAction(
			// `request.method` rather than a literal 'POST': the guard exists to refuse a call that has
			// drifted into a `load`, and a hardcoded value would refuse nothing.
			{ db, secret, method: request.method },
			token,
			verifyUpdatesUnsubscribeToken,
			unsubscribeUpdates
		);
		return { result, token };
	}
};
