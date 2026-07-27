import { getDb, type Db } from '$lib/server/db';
import {
	captureWaitlistFunnel,
	mintWaitlistFlowId,
	newWaitlistFlowId
} from '$lib/server/waitlist-funnel';
import { readEnv } from '$lib/server/env';
import { mintWaitlistFlowClaim } from '$lib/server/waitlist-flow';
import { mintWaitlistToken } from '$lib/server/waitlist-token';
import { verifyWaitlistResume, WAITLIST_RESUME_COOKIE } from '$lib/server/waitlist-resume';
import type { WaitlistFlowId } from '$lib/waitlist-funnel';
import type { PageServerLoad } from './$types';

// /waitlist's server load does two things, and touches the database for neither of them:
//
//   1. Mints the funnel's anonymous flow id and records the view (DAR-66).
//   2. Turns the resume cookie back into the step the visitor left off at (DAR-75).
//
// WHY THE VIEW EVENT RIDES A GET INSTEAD OF `navigator.sendBeacon`. Capturing it here (rather than in
// a client-side beacon to a small POST endpoint, as the ticket sketched) means: no new public write
// endpoint to abuse-proof, no CSP change, no `waitlist_viewed` lost to a blocker or a bounce before
// hydration, and — the reason that decides it — the no-JS visitor is counted like everyone else,
// which matters when the denominator of the primary metric is exactly "people who saw the form".
// It costs one INSERT per page view, fire-and-forget.
//
// WHY THE RESUME READ IS SAFE TO DO ON A PUBLIC PAGE. Everything it needs is inside the visitor's own
// signed cookie, so a GET still asks the database nothing about who is on the list. That is the same
// property the step endpoints keep by routing on the answers just submitted rather than on stored
// state (waitlist-steps.remote.ts' ANTI-ORACLE note): no response here varies with whether an address
// is known.
export const load: PageServerLoad = async ({ request, cookies, platform, setHeaders }) => {
	// Request-scoped reads FIRST, before any await: on workerd `platform.env` is only valid during the
	// request. getDb() reads it sync, and so does readEnv.
	const tokenSecret = readEnv('BETTER_AUTH_SECRET');
	const cookie = cookies.get(WAITLIST_RESUME_COOKIE);

	// NOTE: this load only ever READS the resume state. Clearing it is `restartWaitlist`
	// (waitlist.remote.ts), a POST — deliberately not a `?restart` query parameter handled here, which
	// is what the first cut did. A destructive GET behind an internal link is a trap in a Kit app:
	// `<body>` sets `preload-data="hover"`, so preloading the data ran this load and dropped the cookie
	// on mouse-over, with no click.

	// getDb() throws when the DB env is missing. /waitlist rendered fine without a database before
	// this load existed, and it must keep doing so — showing the form is the page's job; reporting on
	// it is not. Constructed here (sync, pre-await) because platform.env is only readable during the
	// request.
	let db: Db | undefined;
	try {
		db = getDb();
	} catch (err) {
		console.error('waitlist funnel: no database client', err);
	}

	const state = tokenSecret ? await verifyWaitlistResume(tokenSecret, cookie) : null;

	// THIS LOAD IS THE FUNNEL'S ONLY MINTER (DAR-86). Every other surface that records an event takes
	// a SIGNED handle it cannot produce, which is what turns the composite primary key into a real
	// bound: a handle costs a page view, and buys one row per event. `flowId` here is the bare id (the
	// column's form, and the cookie's); `flowHandle` is what the page ships to the browser.
	//
	// A resumed visitor keeps the flow their earlier steps were recorded under; only a genuinely fresh
	// arrival gets a new one. This is the same rule the step responses follow by echoing the submitted
	// handle, and for the same reason: without it a mid-flow reload would split one visitor across two
	// flows, stranding `qualification_completed` on a flow that never recorded a view and quietly
	// corrupting every ratio the funnel exists to report.
	//
	// Re-recording `waitlist_viewed` under a flow that already has one is a no-op — the composite
	// primary key makes the count a count of DISTINCT flows (see $lib/server/waitlist-funnel.ts) — so
	// a reload no longer inflates the denominator either.
	//
	// Without a signing secret there is no handle, so the funnel goes dark UNIFORMLY rather than
	// counting views against zero conversions — a readout that misleads worse than an absent one. Same
	// posture as the rest of the flow there: no continuation token, no resume, no enrich. The id and
	// the handle are therefore minted TOGETHER OR NOT AT ALL: leaving the id usable and guarding the
	// capture separately would make uniform darkness one deletable `&&` rather than a shape.
	let flowId: WaitlistFlowId | null = null;
	let flowHandle = '';
	if (tokenSecret) {
		flowId = state?.flowId || newWaitlistFlowId();
		flowHandle = await mintWaitlistFlowId(tokenSecret, flowId);
	}

	// GET only. Kit re-runs loads when it re-renders the page after a native (no-JS) remote-form POST,
	// and counting those would inflate the funnel's denominator by one view per step — turning the
	// conversion rate for the visitors least able to convert into the worst-looking number on the
	// page. The method is the honest signal for "this is a page view", and it's Kit's own: the POST
	// path is `render_page` → `handle_remote_form_post` → loads, on the same request.
	if (request.method === 'GET') {
		captureWaitlistFunnel(db, platform, flowId, ['waitlist_viewed']);
	}

	if (!state || !tokenSecret) return { flowId: flowHandle, resume: null };

	// A resumed render is the ONLY cacheable response in this flow that carries a continuation token:
	// every in-flight step is rendered as the answer to a POST, and POSTs aren't cached. So say so
	// explicitly rather than relying on "nothing sets cache-control, so nothing caches HTML" — a
	// shared cache storing this page would hand one visitor a write capability for another visitor's
	// row. `private` is the part that matters; `no-store` costs this page its bfcache entry, which is
	// a fair trade for a document that is a per-visitor capability.
	setHeaders({ 'cache-control': 'private, no-store' });

	// Re-mint the two signed values the resumed step needs, from the decisions the cookie carried, so
	// the resumed render is indistinguishable from the in-flight one — the page's props are the same
	// shape either way and it never learns which it got.
	//
	// The token is re-minted rather than stored: a cookie holding a live capability verbatim would be
	// one copy-paste from ending up somewhere else, and the row id it's built from authorizes nothing
	// on its own. `submissionId` is null once the flow is `done`, which is exactly when there is
	// nothing left to authorize.
	return {
		flowId: flowHandle,
		resume: {
			stage: state.stage,
			token: state.submissionId ? await mintWaitlistToken(tokenSecret, state.submissionId) : '',
			// Both halves or neither: step 2 settles them together, so a claim minted from a partial
			// pair would be inventing one of them.
			flowClaim:
				state.branch && state.audience
					? await mintWaitlistFlowClaim(tokenSecret, {
							branch: state.branch,
							audience: state.audience
						})
					: '',
			cta: state.cta
		}
	};
};
