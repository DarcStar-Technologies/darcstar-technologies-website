// The funnel's one client-fired event (DAR-66) — a SvelteKit remote `command`, which is the site's
// first. Every other funnel event coincides with a request the server already handles (the /waitlist
// load, a step submit), so it is captured there; `evaluation_conversation_requested` is the
// exception, because activating the confirmation's pilot CTA opens a modal in place and talks to
// nobody. This is the transport for that, and only that.
//
// A command rather than `navigator.sendBeacon` to a hand-rolled endpoint: same-origin (no CSP
// change — `connect-src 'self'` already covers it), no route to write, typed end to end, and it
// reuses the pipeline the rest of the flow runs on. The click handler that calls it has already
// cancelled the navigation, so there is no unload race for a beacon to solve.
//
// THIS IS A PUBLIC, UNAUTHENTICATED WRITE — treat it as one:
//
//   1. The event slug is checked against CLIENT_FIREABLE_FUNNEL_EVENTS, NOT the full vocabulary. A
//      script may ask for the one event a browser is genuinely the only witness to, and nothing else;
//      being able to POST `qualification_completed` would mean being able to inflate the exact
//      numbers this feature reports. Same mass-assignment guard `applyWaitlistStep` puts on columns.
//   2. The flow id is shape-checked (captureWaitlistFunnel), so the column can only ever hold UUIDs.
//   3. The composite primary key caps a flow at one row per event, so replaying this call is a no-op.
//
// What remains — and is accepted — is that a script can mint fresh flow ids and add a row each time.
// That is true of any anonymous counter, including the view event's plain GET; the readout is an
// internal estimate, labelled as such on /admin/waitlist, not a billing record.
//
// Returns nothing, and the caller doesn't await it: a failed analytics write must never be visible to
// someone who just asked to talk to us.
import { command, getRequestEvent } from '$app/server';
import { getDb, type Db } from '$lib/server/db';
import { captureWaitlistFunnel } from '$lib/server/waitlist-funnel';
import { isClientFireableFunnelEvent } from '$lib/waitlist-funnel';

type WaitlistFunnelInput = {
	/** Must be a member of CLIENT_FIREABLE_FUNNEL_EVENTS; anything else is dropped. */
	event: string;
	/** The flow id this page was rendered with. Shape-checked downstream. */
	flowId: string;
};

export const recordWaitlistFunnelEvent = command<WaitlistFunnelInput, void>(
	'unchecked',
	(input) => {
		// Request-scoped handles first — platform.env is only valid during the request. Nothing here
		// awaits, but keep the ordering the rest of the codebase relies on.
		const { platform } = getRequestEvent();
		let db: Db | undefined;
		try {
			db = getDb();
		} catch (err) {
			console.error('waitlist funnel: no database client', err);
		}

		// `'unchecked'` means `input` is whatever was on the wire — including undefined.
		if (!isClientFireableFunnelEvent(input?.event)) return;

		captureWaitlistFunnel(db, platform, input?.flowId, [input.event]);
	}
);
