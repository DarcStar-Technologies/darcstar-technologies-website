// Waitlist funnel analytics — the write path and the admin readout (DAR-66). Server-only: the slug
// vocabulary and its validators are client-safe ($lib/waitlist-funnel.ts) because a component fires
// one of them, but nothing that touches the database belongs anywhere a public page can import.
//
// THE POSTURE IS FIRE-AND-FORGET, and that is the whole design constraint. These rows are a
// nice-to-have; the signup they measure is not. `captureWaitlistFunnel` therefore returns void rather
// than a promise, swallows every failure, and hands the insert to `ctx.waitUntil` so it settles after
// the response — exactly the contract the Resend notifications run under (waitlist.remote.ts). A
// caller CANNOT accidentally make analytics block or break a submit, because there is nothing to
// await and nothing that throws.
//
// That also keeps the hermetic e2e green: with a placeholder DATABASE_URL the insert rejects at the
// network, the rejection is caught here, and /waitlist renders and advances exactly as before.
import { count } from 'drizzle-orm';
import { waitlistFunnelEvent } from './db/schema';
import type { Db } from './db';
import { isDecoyWaitlistId } from './waitlist-token';
import {
	WAITLIST_FUNNEL_EVENTS,
	isWaitlistFlowId,
	isWaitlistFunnelEvent,
	type WaitlistFunnelEvent
} from '$lib/waitlist-funnel';

/**
 * Record one or more funnel events for a flow. Never throws, never blocks, returns nothing.
 *
 * `flowId` is typed `unknown` on purpose: every caller gets it from a hidden form field or a public
 * command — i.e. from the client — so the shape check belongs HERE rather than at each call site,
 * where one forgotten validation would be a column full of attacker-supplied text. A malformed id is
 * dropped silently (there is no caller who could act on the error, and no visitor who should see one).
 *
 * Unknown slugs are dropped the same way. The type makes that unreachable from our own code, which is
 * the point — the runtime guard is for the command endpoint, where the value came off the wire.
 *
 * @param db        request-scoped client (construct it before the first await, per getDb's contract).
 *                  Accepts `undefined` so a caller whose `getDb()` threw — a missing DB env — can
 *                  pass the failure straight through rather than branch: no database is simply no
 *                  analytics, never a broken page.
 * @param platform  the request's platform, for `ctx.waitUntil`; absent under `vite dev`, where the
 *                  floating promise is fine because the process outlives the response
 */
export function captureWaitlistFunnel(
	db: Db | undefined,
	platform: App.Platform | undefined,
	flowId: unknown,
	events: readonly WaitlistFunnelEvent[]
): void {
	if (!db || !isWaitlistFlowId(flowId)) return;

	// De-dupe within the batch as well as across requests: a caller that passes the same slug twice
	// would otherwise make SQLite reject the whole statement on its own conflict, taking the sibling
	// events down with it. The DB's composite key is still the durable cap — this only keeps one
	// statement internally consistent.
	const slugs = [...new Set(events)].filter(isWaitlistFunnelEvent);
	if (slugs.length === 0) return;

	const write = db
		.insert(waitlistFunnelEvent)
		.values(slugs.map((event) => ({ flowId, event })))
		// At most one row per (flow_id, event) — the composite primary key. A replayed submit, a
		// double-click, or a bot re-POSTing the same step is a no-op rather than a duplicate, so every
		// count stays a count of distinct flows.
		.onConflictDoNothing()
		.catch((err: unknown) => {
			console.error('waitlist funnel capture failed', slugs.join(','), err);
		});

	// waitUntil keeps the Worker alive until the insert settles without holding up the response. The
	// promise already has its own .catch, so an unhandled rejection can't escape either way.
	platform?.ctx?.waitUntil(write);
}

/**
 * The token-gated steps' entry point (DAR-83) — `captureWaitlistFunnel` plus the honeypot gate.
 *
 * Step 1 has always recorded NO signup event when the honeypot trips, so bots stay out of the
 * conversion metric. Steps 2–4 were the exception: a bot that tripped the trap and then drove the
 * rest of the flow on its decoy token still emitted `qualification_started` and everything after it,
 * so the later stages could exceed `waitlist_signup_completed` — a sequence that cannot happen, which
 * sends whoever next reads /admin/waitlist hunting a bug that isn't there. Our own hermetic e2e does
 * exactly that, since it reaches the token-gated steps VIA the decoy token. The honeypot's effect is
 * now uniform across both surfaces: no row in `waitlist_submission`, no row in `waitlist_funnel_event`.
 *
 * THE GATE IS THE ROW ID THE STEP ALREADY RESOLVED. DAR-66 weighed this and priced it at "an HMAC per
 * step", but that HMAC is unavoidable and already paid — every step verifies the continuation token
 * before it can enrich, and since DAR-75 the resume cookie needs the id too. What is left is a string
 * comparison.
 *
 * DECOY ONLY, NEVER A NULL ID. A null id (absent, malformed, expired, tampered, or no signing secret)
 * is NOT a bot signal: it covers the visitor whose token aged out mid-flow, who really did reach this
 * stage, and a deploy with no `BETTER_AUTH_SECRET` would take the entire step funnel dark rather than
 * merely stop enriching. A decoy is the one id that carries a positive signal — it exists only because
 * someone filled a field no human can see.
 *
 * Suppressing is safe HERE and nowhere else on the honeypot path: the insert is fire-and-forget inside
 * `ctx.waitUntil` and the counts live behind /admin, so a row that never gets written is invisible to
 * the caller. That is precisely what isn't true of the decoy token or the resume cookie, which the trap
 * mints and sets because their absence WOULD be a detectable response difference.
 *
 * @param rowId  the submission this step's token authorizes, straight from `verifyWaitlistToken`
 */
export function captureWaitlistStepFunnel(
	db: Db | undefined,
	platform: App.Platform | undefined,
	rowId: string | null,
	flowId: unknown,
	events: readonly WaitlistFunnelEvent[]
): void {
	if (rowId !== null && isDecoyWaitlistId(rowId)) return;
	captureWaitlistFunnel(db, platform, flowId, events);
}

/** One event slug → how many distinct flows reached it. Every slug is present, zero included. */
export type WaitlistFunnelCounts = Record<WaitlistFunnelEvent, number>;

/**
 * Read the funnel counts for /admin/waitlist. All-time and unfiltered — a first readout, not a
 * dashboard.
 *
 * Zero-fills every known slug so the view renders the full funnel (a stage nobody has reached yet is
 * a `0`, which is information, rather than a missing row). Rows carrying a slug that is no longer in
 * the vocabulary are ignored rather than shown: they'd have no label, and dropping a retired event
 * from the list should retire it from the readout too.
 */
export async function readWaitlistFunnelCounts(db: Db): Promise<WaitlistFunnelCounts> {
	const rows = await db
		.select({ event: waitlistFunnelEvent.event, total: count() })
		.from(waitlistFunnelEvent)
		.groupBy(waitlistFunnelEvent.event);

	const counts = Object.fromEntries(
		WAITLIST_FUNNEL_EVENTS.map((event) => [event, 0])
	) as WaitlistFunnelCounts;
	for (const row of rows) {
		if (isWaitlistFunnelEvent(row.event)) counts[row.event] = row.total;
	}
	return counts;
}

/**
 * The primary metric: initial signup conversion, as a fraction of the flows that saw the page.
 *
 * Null — not zero — when nothing has been viewed yet: with no denominator there is no rate, and a
 * displayed "0%" would read as "nobody converts" rather than "nothing measured". The admin view
 * renders that null as a dash.
 *
 * Deliberately NOT clamped to ≤ 1. A ratio above 100% would mean signups arrived without a matching
 * view row (a bot posting straight to the endpoint, or a lost view write), and silently capping it
 * would hide exactly that. It's an internal readout; showing the honest number is the point.
 */
export function signupConversionRate(counts: WaitlistFunnelCounts): number | null {
	const viewed = counts.waitlist_viewed;
	return viewed > 0 ? counts.waitlist_signup_completed / viewed : null;
}
