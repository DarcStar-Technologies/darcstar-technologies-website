import { getDb, type Db } from '$lib/server/db';
import { captureWaitlistFunnel } from '$lib/server/waitlist-funnel';
import type { PageServerLoad } from './$types';

// /waitlist's only server-side work: mint the funnel's anonymous flow id and record the view (DAR-66).
// The page itself is still driven entirely by the remote forms — this load returns one string.
//
// WHY THE VIEW EVENT RIDES A GET INSTEAD OF `navigator.sendBeacon`. Capturing it here (rather than in
// a client-side beacon to a small POST endpoint, as the ticket sketched) means: no new public write
// endpoint to abuse-proof, no CSP change, no `waitlist_viewed` lost to a blocker or a bounce before
// hydration, and — the reason that decides it — the no-JS visitor is counted like everyone else,
// which matters when the denominator of the primary metric is exactly "people who saw the form".
// It costs one INSERT per page view, fire-and-forget.
export const load: PageServerLoad = ({ request, platform }) => {
	// A fresh id per render. It is the ONLY thing that ties this visitor's funnel rows together, and
	// it's random rather than derived: an analytics row must not be walkable back to a person (see
	// $lib/waitlist-funnel.ts). The forms carry it forward in a hidden field, and each step response
	// echoes it, so a no-JS visitor keeps ONE flow id across the native per-step POSTs even though
	// this load re-runs and mints another one it won't use.
	const flowId = crypto.randomUUID();

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

	// GET only. Kit re-runs loads when it re-renders the page after a native (no-JS) remote-form POST,
	// and counting those would inflate the funnel's denominator by one view per step — turning the
	// conversion rate for the visitors least able to convert into the worst-looking number on the
	// page. The method is the honest signal for "this is a page view", and it's Kit's own: the POST
	// path is `render_page` → `handle_remote_form_post` → loads, on the same request.
	if (request.method === 'GET') {
		captureWaitlistFunnel(db, platform, flowId, ['waitlist_viewed']);
	}

	return { flowId };
};
