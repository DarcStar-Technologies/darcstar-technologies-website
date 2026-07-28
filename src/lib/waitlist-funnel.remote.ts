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
//   2. The flow id must VERIFY (DAR-86) — it is a signed handle minted only by /waitlist's load, so
//      this endpoint can no longer be fed fresh ids. The column still gets the bare UUID inside it.
//   3. The composite primary key caps a flow at one row per event, so replaying this call is a no-op.
//
// (2) and (3) together are the bound: an extra row costs a page view, which is the same floor the
// view event's own plain GET has and the one DAR-66 accepted as irreducible without a captcha. Before
// signing, this call took any well-formed UUID, so a script could add a row per POST — the readout is
// still an internal estimate, labelled as such on /admin/waitlist, but it is no longer free to inflate.
//
// Returns nothing, and the caller doesn't await it: a failed analytics write must never be visible to
// someone who just asked to talk to us.
import { command, getRequestEvent } from '$app/server';
import { getDb, type Db } from '$lib/server/db';
import { captureWaitlistFunnel, resolveWaitlistFlowId } from '$lib/server/waitlist-funnel';
import { readEnv } from '$lib/server/env';
import { isClientFireableFunnelEvent } from '$lib/waitlist-funnel';

type WaitlistFunnelInput = {
	/** Must be a member of CLIENT_FIREABLE_FUNNEL_EVENTS; anything else is dropped. */
	event: string;
	/** The signed handle this page was rendered with. Verified downstream (DAR-86). */
	flowId: string;
};

export const recordWaitlistFunnelEvent = command<WaitlistFunnelInput, void>(
	'unchecked',
	async (input) => {
		// Request-scoped handles first — platform.env is only valid during the request, and this
		// function now awaits (the handle's signature check), so both reads must precede it.
		const { platform } = getRequestEvent();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');
		let db: Db | undefined;
		try {
			db = getDb();
		} catch (err) {
			console.error('waitlist funnel: no database client', err);
		}

		// `'unchecked'` means `input` is whatever was on the wire — including undefined.
		if (!isClientFireableFunnelEvent(input?.event)) return;

		// The one crossing (DAR-86). This endpoint is the flow's most exposed write — no token, no
		// form, no page state — so "the handle has to have come from a page load" is doing most of the
		// work here. The caller doesn't await this command, so the extra round trip costs them nothing.
		const flowId = await resolveWaitlistFlowId(tokenSecret, input?.flowId);
		captureWaitlistFunnel(db, platform, flowId, [input.event]);
	}
);
