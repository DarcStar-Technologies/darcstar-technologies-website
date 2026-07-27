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
import {
	isDecoyWaitlistId,
	mintSignedValue,
	verifySignedValue,
	WAITLIST_TOKEN_TTL_SECONDS
} from './waitlist-token';
import {
	WAITLIST_FUNNEL_EVENTS,
	SIGNED_FLOW_ID_MAX,
	isWaitlistFlowId,
	isWaitlistFunnelEvent,
	type WaitlistFlowId,
	type WaitlistFunnelEvent
} from '$lib/waitlist-funnel';

// ---------------------------------------------------------------------------------------------
// The signed flow id (DAR-86) — the fourth value on the shared signing core, after the continuation
// token (waitlist-token.ts), the flow claim (waitlist-flow.ts) and the resume cookie
// (waitlist-resume.ts).
//
// WHAT IT FIXES. `flow_id` used to travel as a bare UUID in a hidden field, and the capture accepted
// any well-formed one. The composite primary key `(flow_id, event)` caps a FLOW at one row per event,
// but the caller picked the flow — a fresh `crypto.randomUUID()` per POST defeated that cap
// completely, and the step endpoints needed no continuation token to reach the insert at all. A bare
// POST at step 2 wrote analytics rows for free, as did the public command.
//
// WHAT IT BUYS. Only ids WE minted can write, minting happens in one place (the /waitlist load), and
// the composite key then caps that page load at one row per event. So a row costs a page view — the
// same floor `waitlist_viewed` has always had, and the floor DAR-66 accepted as irreducible without a
// captcha. This does not make the table unwritable by a script; it makes each write cost what an
// honest visitor's write costs.
//
// THE COLUMN STILL HOLDS THE BARE UUID. Only the TRANSPORT is signed, so the schema, every existing
// row and every count are untouched — there is no migration, and "a count of distinct flows" still
// means what it did. The two forms are DIFFERENT TYPES (`WaitlistFlowId` is branded), so every
// request crosses between them exactly once, at `resolveWaitlistFlowId`, and a call site that skipped
// the crossing wouldn't compile. That is the structural half of the guard; the shape check inside the
// capture is the runtime half, and it is why forgetting fails CLOSED even under a cast — a signed
// handle is not UUID-shaped, so it records nothing rather than everything.
//
// THE RESUME COOKIE (DAR-75) CARRIES THE BARE ID, not the handle, and that isn't a preference: the
// signing core splits on '.', so a signed value cannot be a field inside another signed value. Which
// settles the shape of everything above — the steps have to hold the bare id for the cookie anyway,
// so they may as well be the ones that verify, and the capture can keep taking something already
// vouched for.
//
// ANONYMITY IS UNCHANGED (DAR-66 rule 3): the payload is still a random per-page-load id, not derived
// from the row or the email, so an analytics row still cannot be walked back to a person.
const FLOW_ID_DOMAIN = 'darcstar:waitlist-funnel:v1';
// `n1` for the fun(n)el handle — `f1` is the flow CLAIM's and the two are different values. A handle
// minted here can never verify as a claim, a continuation token or a resume value, and vice versa,
// even though all four key off BETTER_AUTH_SECRET.
const FLOW_ID_PREFIX = 'n1';

/**
 * A brand-new flow id. The ONE place a `WaitlistFlowId` comes into existence unverified — everything
 * else has to earn one from a signature — so it is deliberately tiny and deliberately server-side.
 */
export const newWaitlistFlowId = (): WaitlistFlowId => crypto.randomUUID() as WaitlistFlowId;

/**
 * Sign a flow id for transport. Minted in ONE place — /waitlist's server load — which is what makes
 * "a page load is required to obtain one" true.
 *
 * Same 24h TTL as the continuation token and the resume cookie: they all cover one sitting with the
 * form. The expiry is not what bounds abuse here (the composite key does that, absolutely and
 * forever — a handle is worth at most one row per event no matter how long it lives); it bounds how
 * long a visitor's flow stays attributable, which is why it matches the window the rest of the flow
 * already runs on.
 */
export function mintWaitlistFlowId(
	secret: string,
	flowId: WaitlistFlowId,
	now: number = Date.now()
): Promise<string> {
	return mintSignedValue(
		secret,
		FLOW_ID_DOMAIN,
		FLOW_ID_PREFIX,
		flowId,
		WAITLIST_TOKEN_TTL_SECONDS,
		now
	);
}

/**
 * A signed flow id → the bare UUID it carries, or null for ANY failure (absent, malformed, expired,
 * tampered, wrong secret, or a value signed for a different purpose — including one of the flow's
 * other three signed values).
 *
 * The payload is shape-checked on the way out as well as verified. A valid MAC over a non-UUID can't
 * happen without the secret, but the check is what keeps "this column only ever holds fixed-width
 * opaque ids" a property of the code rather than of who happens to call the minter.
 *
 * Junk shouldn't buy an HMAC, so an over-long value is rejected first — at the SAME cap the echo
 * truncates to (`SIGNED_FLOW_ID_MAX`), which is the property that makes the pair consistent: anything
 * an echo could produce still verifies, and anything longer was never ours.
 */
export async function verifyWaitlistFlowId(
	secret: string,
	value: unknown,
	now: number = Date.now()
): Promise<WaitlistFlowId | null> {
	if (typeof value !== 'string' || value.length > SIGNED_FLOW_ID_MAX) return null;
	const payload = await verifySignedValue(secret, FLOW_ID_DOMAIN, FLOW_ID_PREFIX, value, now);
	return payload !== null && isWaitlistFlowId(payload) ? payload : null;
}

/**
 * THE ONE CROSSING from wire to vouched-for, and every public entry point that records a funnel event
 * goes through it: the signup, all four qualification steps, and the confirmation's command. Never
 * throws — analytics may fail, and a visitor must never find out (the same contract `resolveStepRow`
 * keeps for the continuation token, which sits beside it in every step).
 *
 * Null covers everything: no signing secret, absent, malformed, expired, tampered, or a value signed
 * for one of the flow's other purposes. There is nothing a caller could usefully do with the
 * distinction, and nothing a visitor should see.
 */
export async function resolveWaitlistFlowId(
	secret: string | undefined,
	value: unknown
): Promise<WaitlistFlowId | null> {
	if (!secret) return null; // misconfigured env: the flow still works, it just isn't measured
	try {
		return await verifyWaitlistFlowId(secret, value);
	} catch (err) {
		console.error('waitlist funnel handle verification failed', err);
		return null;
	}
}

/**
 * Record one or more funnel events for a flow. Never throws, never blocks, returns nothing.
 *
 * `flowId` IS THE VOUCHED-FOR ID, not the wire value: a public entry point gets one from
 * `resolveWaitlistFlowId` and passes it here, and the brand is what makes skipping that step a
 * compile error rather than an unbounded insert (DAR-86). `null` — no secret, or a handle that didn't
 * verify — records nothing, silently: there is no caller who could act on the error, and no visitor
 * who should see one.
 *
 * The shape check survives underneath the brand, and it is what makes a mistake fail CLOSED even if
 * someone casts past the type: a signed handle isn't UUID-shaped, so it would record nothing rather
 * than fill the column with attacker-supplied text.
 *
 * Unknown slugs are dropped the same way. The type makes that unreachable from our own code, which is
 * the point — the runtime guard is for the command endpoint, where the slug came off the wire.
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
	flowId: WaitlistFlowId | null,
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
		// count stays a count of distinct flows. Since a flow id can only come from a page load
		// (DAR-86), this is also the abuse bound: one load, one row per event, forever.
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
	flowId: WaitlistFlowId | null,
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
