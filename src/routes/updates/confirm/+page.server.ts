import type { Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { waitlistSigningSecret } from '$lib/server/waitlist-secret';
import { runUpdatesAction } from '$lib/server/waitlist-updates-action';
import { confirmUpdates } from '$lib/server/waitlist-store';
import { verifyUpdatesConfirmToken } from '$lib/server/waitlist-updates-token';
import type { PageServerLoad } from './$types';

// Double opt-in, landing half (DAR-139). The confirmation email links here with a `c1` token; pressing
// the button is what records consent.
//
// THE MUTATION IS A POST, AND THIS IS THE PAGE THAT REQUIRES IT. Corporate mail scanners and link
// previewers follow every URL in an inbound message, so a confirmation that happened on GET would be
// confirmed by a machine on delivery — double opt-in that verifies nothing, and worse than no gate at
// all because it would look like one. DAR-75 states the general rule (a state mutation belongs behind
// a POST); here it is the entire security property.
//
// The load verifies too, so a dead link says so before anyone presses anything. That costs one HMAC and
// NO database access, which is the property worth noting: a GET here cannot tell a live lead from a
// deleted one, so the page is not an existence oracle even for somebody holding a valid token. Only the
// POST touches a row.
//
// Single `default` action ONLY — do NOT add a named action beside it (SvelteKit's
// check_named_default_separate 500s every POST if a page mixes default + named; see #122).

export const load: PageServerLoad = async ({ url }) => {
	const secret = waitlistSigningSecret();
	const token = url.searchParams.get('token') ?? '';
	// Absent, unreadable, expired, tampered, or minted for the unsubscribe page: one answer for all of
	// them (see runUpdatesAction).
	const invalid = !secret || (await verifyUpdatesConfirmToken(secret, token)) === null;
	// Echoed into a hidden field so the POST never depends on the URL keeping its query string across a
	// no-JS re-render — the pattern /reset-password uses.
	return { token, invalid };
};

export const actions: Actions = {
	default: async ({ request }) => {
		// Request-scoped env: both read before the first await, or `platform.env` comes back empty.
		const db = getDb();
		const secret = waitlistSigningSecret();

		const data = await request.formData();
		const token = String(data.get('token') ?? '');

		const result = await runUpdatesAction(
			// `request.method` rather than a literal 'POST': the guard exists to refuse a call that has
			// drifted into a `load`, and a hardcoded value would refuse nothing.
			{ db, secret, method: request.method },
			token,
			verifyUpdatesConfirmToken,
			confirmUpdates
		);
		// Echoed back so a retry after a transient failure keeps the link (no-JS re-render safety).
		return { result, token };
	}
};
