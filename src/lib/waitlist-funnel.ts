// Waitlist funnel analytics vocabulary (DAR-66) — the event slugs and the two validators that guard
// what may be written. Client-safe (NO server or SvelteKit imports), the same split every other
// waitlist vocabulary uses: the slugs live out here because the confirmation screen fires one of them
// and /admin/waitlist labels all of them, while the DECISION to record — and the DB write — is
// server-only (src/lib/server/waitlist-funnel.ts).
//
// WHAT THIS IS NOT: there is no third-party analytics here, and deliberately so. The site had no
// analytics at all before this, and a hosted script would need a new CSP origin (vite.config.ts) plus
// a synthetic probe, would ship an identifier to someone else's server, and would be blocked for a
// meaningful share of exactly the technical audience this funnel measures. First-party rows in our own
// Turso DB cost one INSERT and answer the only questions being asked.
//
// WHAT A ROW MAY CONTAIN: an event slug, an anonymous `flow_id`, and a timestamp. Nothing else — no
// IP, no user agent, no email, no answer text. That's a hard rule, not a default: `deployment_scale`
// and the money answers are internal-only free text (DAR-58) and must never reach an analytics row.
// The schema has no column they could go in, which is the same "make it structural" move DAR-65's
// classifier used to keep dollar figures out of the rubric.

/**
 * Every event the funnel can record, in FUNNEL ORDER — the order a single visitor would emit them.
 * The admin readout renders the list in this order, so drop-off reads top-to-bottom.
 *
 * The `flow_id` is what ties them together; each is at most ONCE per flow (see
 * `src/lib/server/waitlist-funnel.ts` — the DB enforces it), so every count below is a count of
 * distinct flows that reached that milestone. That's what makes them divisible: the primary metric is
 * `waitlist_signup_completed / waitlist_viewed`, which is only a conversion rate if neither side can
 * double-count a single visitor.
 *
 * Where each one fires:
 *
 * - `waitlist_viewed` .................. a GET of /waitlist (the load; +page.server.ts).
 * - `waitlist_signup_completed` ........ step 1 accepted (`joinWaitlist`). Fires for a re-signup of a
 *                                        known email too — the visitor completed the step either way,
 *                                        and treating the two differently here would rebuild the
 *                                        enumeration signal the response shape exists to hide.
 * - `qualification_started` ............ step 2 SUBMITTED, either button. The gap between this and
 *                                        `waitlist_signup_completed` is the flow's biggest question:
 *                                        step-1 success always shows step 2, so that gap is exactly
 *                                        the people who saw the questions and closed the tab.
 * - `use_case_completed` ............... step 2 answered (Continue, with at least one answer) — the
 *                                        distinction from `qualification_started`, which a Skip also
 *                                        fires.
 * - `commercial_context_completed` ..... step 3 answered (Continue, at least one answer).
 * - `pilot_interest_selected` .......... step 4A submitted with a VALID pilot answer. Any answer,
 *                                        including `not-currently` — this measures the question being
 *                                        answered, not the answer being yes.
 * - `qualification_completed` .......... the flow reached the confirmation, from any step and by
 *                                        either button.
 * - `evaluation_conversation_requested`  the confirmation's pilot CTA was activated. The ONE event
 *                                        with no POST to ride on, so it's the one the client fires.
 */
export const WAITLIST_FUNNEL_EVENTS = [
	'waitlist_viewed',
	'waitlist_signup_completed',
	'qualification_started',
	'use_case_completed',
	'commercial_context_completed',
	'pilot_interest_selected',
	'qualification_completed',
	'evaluation_conversation_requested'
] as const;
export type WaitlistFunnelEvent = (typeof WAITLIST_FUNNEL_EVENTS)[number];

/**
 * The subset a BROWSER is allowed to ask for.
 *
 * The client-fired transport (waitlist-funnel.remote.ts) is an unauthenticated public endpoint, so
 * its input is bounded by an explicit allowlist rather than by the full vocabulary — the same
 * mass-assignment guard `applyWaitlistStep` puts on the columns each step may write. Every other
 * event coincides with a server-side decision (a load, a validated step submit), and letting a script
 * POST `qualification_completed` would let anyone inflate the exact numbers this feature exists to
 * report.
 *
 * Only the confirmation's pilot CTA is in here, because it is the only funnel moment that does not
 * pass through the server on its own.
 */
export const CLIENT_FIREABLE_FUNNEL_EVENTS = ['evaluation_conversation_requested'] as const;
export type ClientFireableFunnelEvent = (typeof CLIENT_FIREABLE_FUNNEL_EVENTS)[number];

/** Is this a known funnel event? Unknown slugs are dropped, never stored (the ticket's noise rule). */
export const isWaitlistFunnelEvent = (value: unknown): value is WaitlistFunnelEvent =>
	typeof value === 'string' && (WAITLIST_FUNNEL_EVENTS as readonly string[]).includes(value);

/** Is this an event a browser may ask us to record? A strict subset of the above. */
export const isClientFireableFunnelEvent = (value: unknown): value is ClientFireableFunnelEvent =>
	typeof value === 'string' && (CLIENT_FIREABLE_FUNNEL_EVENTS as readonly string[]).includes(value);

/**
 * Canonical UUID form — what `crypto.randomUUID()` produces, which is the only thing that ever mints
 * a flow id (`+page.server.ts`).
 *
 * Anchored and case-insensitive. This is a WRITE GUARD, not a parser: the flow id arrives from a
 * hidden form field or a public command, so it is attacker-controlled, and without a shape check the
 * column would accept arbitrary text of arbitrary length from anyone. Rejecting anything that isn't a
 * UUID keeps the table to fixed-width opaque ids and gives a bot nothing to smuggle in.
 *
 * Deliberately NOT version-pinned (`[1-5]`/`[89ab]`): the value carries no meaning beyond "one
 * visitor's pass through the flow", so a future runtime's v7 id should keep working. Shape is the
 * only property worth enforcing.
 */
const FLOW_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this a well-formed flow id?
 *
 * A flow id is an ANONYMOUS, per-page-load random value. It is explicitly NOT the waitlist row id and
 * NOT derived from the email — it must not be possible to walk back from an analytics row to a person,
 * and a derived (rather than random) id would be exactly that, joinable to the signups table by anyone
 * who could recompute it.
 */
export const isWaitlistFlowId = (value: unknown): value is string =>
	typeof value === 'string' && FLOW_ID_RE.test(value);

/**
 * A submitted flow id, reflected back for the next step's hidden field, or `''` if it wasn't one.
 *
 * The step responses echo the flow id exactly as they echo the continuation token, and for the same
 * reason: without JS each step is a native POST that re-renders the page, and the load re-runs and
 * mints a fresh id. Echoing keeps one visitor on one flow across the whole funnel.
 *
 * Unlike the token's echo — which caps length and lets junk through to fail verification later — this
 * one drops a malformed value outright. There's no downstream check to defer to, and the page treats
 * `''` as "no echo" and falls back to the id its load just minted, so a bad submission costs that
 * visitor a split funnel rather than anything worse.
 */
export const echoFlowId = (value: unknown): string => (isWaitlistFlowId(value) ? value : '');
