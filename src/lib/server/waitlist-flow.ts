// Waitlist v2 flow routing (DAR-62, DAR-63, DAR-64) — the single source of truth for WHICH step a
// submitter sees next: the commercial/non-commercial split that gates step 3 (which DAR-65's lead
// classifier reuses), the step-4 A/B fork, and the confirmation's personalized CTA. Implemented once
// here rather than restated per step.
//
// Deliberately under $lib/server: the routing decision must never be client-authoritative, and
// SvelteKit's import guard makes that structural instead of a convention — a component physically
// cannot import this module. The browser learns the next step ONLY from a step endpoint's response
// (waitlist-steps.remote.ts), which derives it from the answers just submitted.
//
// No DB and no request context (the flow claim below needs only Web Crypto) → unit-tested in
// waitlist-flow.spec.ts.
//
// NOT AN AUTHORIZATION BOUNDARY. Skipping step 3 is a UX routing decision, not a permission: a
// crafted POST straight to the step-3 endpoint is still validated + stored (token permitting), and
// the classifier judges the submitter by their role either way. Answering step 3 buys no privilege,
// so nothing here needs to be re-enforced at the write. The flow claim is signed for a different
// reason — see `mintWaitlistFlowClaim`.
import type { WaitlistRole } from '$lib/waitlist-roles';
import {
	WAITLIST_V2_ROLES,
	WAITLIST_APPLICATIONS,
	isPositivePilotInterest,
	type WaitlistV2Role,
	type WaitlistApplication,
	type WaitlistTimeline,
	type WaitlistCta
} from '$lib/waitlist-qualification';
import { mintSignedValue, verifySignedValue, WAITLIST_TOKEN_TTL_SECONDS } from './waitlist-token';
import type { WaitlistSigningSecret } from './waitlist-secret';

/**
 * v1 role slug → nearest v2 equivalent. The `role` column holds BOTH slug sets (v1 values survive
 * as history; DAR-61's step 2 writes the v2 set), so every consumer that BRANCHES on role must
 * canonicalize first — otherwise a legacy `research` row reads as "not a researcher" and gets asked
 * budget questions. Keyed by the v1 list so a change there is a type error here, not a silent gap.
 */
const V1_TO_V2: Record<WaitlistRole, WaitlistV2Role> = {
	founder: 'founder-executive',
	engineering: 'engineering-leader',
	product: 'product-operations',
	research: 'researcher',
	operations: 'product-operations',
	investor: 'investor-advisor',
	student: 'student',
	other: 'other'
};

/** A stored/submitted role → its v2 slug, or null when absent or unrecognized (see `isCommercialUseCase`
 *  for why unrecognized is treated as "no answer" rather than guessed at). v2 slugs pass through. */
export function canonicalizeWaitlistRole(role: string | null | undefined): WaitlistV2Role | null {
	if (!role) return null;
	if ((WAITLIST_V2_ROLES as readonly string[]).includes(role)) return role as WaitlistV2Role;
	return V1_TO_V2[role as WaitlistRole] ?? null;
}

/** Roles that route PAST step 3 — they aren't evaluating a purchase (DAR-62's gating rule). */
const NON_COMMERCIAL_ROLES: readonly WaitlistV2Role[] = [
	'researcher',
	'student',
	'investor-advisor'
];

/** Applications that route past step 3 for the same reason. */
const NON_COMMERCIAL_APPLICATIONS: readonly WaitlistApplication[] = ['research-education'];

const asApplication = (v: string | null | undefined): WaitlistApplication | null =>
	v && (WAITLIST_APPLICATIONS as readonly string[]).includes(v) ? (v as WaitlistApplication) : null;

/**
 * Is this a commercial/operational use case — i.e. worth asking about value, budget and adoption
 * evidence (step 3)?
 *
 * DAR-62's rule is the exclusion half: a `researcher`/`student`/`investor-advisor` role, or a
 * `research-education` application, routes past step 3. The other half is FAIL-SAFE POLARITY —
 * commercial requires a POSITIVE signal, so an unanswered (or unrecognized) role AND application
 * reads as non-commercial rather than as a prospect. That matches the epic's own polarity for the
 * step-4 fork ("everything else, incl. unanswered → branch B") and keeps money questions away from
 * anyone we can't actually classify. One answered, non-excluded field is enough of a signal.
 */
export function isCommercialUseCase(answers: {
	role: string | null;
	primaryApplication: string | null;
}): boolean {
	const role = canonicalizeWaitlistRole(answers.role);
	const application = asApplication(answers.primaryApplication);

	if (role === null && application === null) return false; // nothing to classify
	if (role !== null && NON_COMMERCIAL_ROLES.includes(role)) return false;
	if (application !== null && NON_COMMERCIAL_APPLICATIONS.includes(application)) return false;
	return true;
}

/**
 * Who this signup is, as far as step 2 told us — the flow state DAR-64's confirmation CTA is chosen
 * from. Three values, because the step-3 gate's boolean loses the distinction that matters here:
 * "told us they're a researcher" and "told us nothing" are both non-commercial, but only one of them
 * has an interest worth pointing at.
 *
 *   - `commercial` — `isCommercialUseCase` (the step-3 gate, reused rather than restated).
 *   - `research`   — an answered but excluded signal: a researcher/student/investor-advisor role, or
 *                    a research-education application. (An investor lands here too. The visitor-facing
 *                    CTA set has four entries and publications are the honest thing to offer them;
 *                    DAR-65's classifier is where investors get their own INTERNAL bucket.)
 *   - `general`    — nothing recognized was answered.
 *
 * Same fail-safe polarity as everything else in this module: unanswered and unrecognized fall to the
 * least-committal end, never to "prospect".
 */
export const WAITLIST_AUDIENCES = ['commercial', 'research', 'general'] as const;
export type WaitlistAudience = (typeof WAITLIST_AUDIENCES)[number];

export function audienceFor(answers: {
	role: string | null;
	primaryApplication: string | null;
}): WaitlistAudience {
	if (isCommercialUseCase(answers)) return 'commercial';
	const role = canonicalizeWaitlistRole(answers.role);
	const application = asApplication(answers.primaryApplication);
	return role === null && application === null ? 'general' : 'research';
}

/** The step-4 fork (DAR-63): A = pilot details, B = research/general preferences. */
export const WAITLIST_STEP4_BRANCHES = ['step4a', 'step4b'] as const;
export type WaitlistStep4Branch = (typeof WAITLIST_STEP4_BRANCHES)[number];

/** Timelines that read as active commercial interest — an evaluation window inside 12 months. */
const ACTIVE_EVALUATION_TIMELINES: readonly WaitlistTimeline[] = [
	'evaluating-now',
	'within-3-months',
	'3-12-months'
];

/**
 * Is this an active (within-12-months) evaluation window? DAR-63's branch-A test, exported because
 * DAR-65's classifier needs the same threshold for its Priority-B floor — one list, two readers,
 * rather than a second copy that can drift. Fail-safe: unanswered and unrecognized are NOT active.
 */
export function isActiveEvaluationTimeline(evaluationTimeline: string | null | undefined): boolean {
	return (
		evaluationTimeline != null &&
		(ACTIVE_EVALUATION_TIMELINES as readonly string[]).includes(evaluationTimeline)
	);
}

/**
 * Which step-4 branch an evaluation timeline earns. FAIL-SAFE POLARITY again, and this time it's
 * the epic's own wording: branch A needs a positive, recognized, near-term answer; "everything else
 * (incl. unanswered) → B". B asks for nothing sensitive, so an unclassifiable visitor lands there.
 *
 * Deliberately keyed on the TIMELINE ALONE. Role/application gate step 3 (`isCommercialUseCase`),
 * not this fork — a researcher who says they're evaluating now is asked the branch-A question too,
 * which is DAR-63's rule as written.
 */
export function step4BranchFor(evaluationTimeline: string | null | undefined): WaitlistStep4Branch {
	return isActiveEvaluationTimeline(evaluationTimeline) ? 'step4a' : 'step4b';
}

/**
 * Everything step 2 decided that a LATER step still needs. Both facts are settled by the step-2
 * answers and neither is re-askable afterwards, so they travel together (see `mintWaitlistFlowClaim`).
 */
export interface WaitlistFlowState {
	/** Which step-4 branch the evaluation timeline earned — read by step 3, which routes to it. */
	branch: WaitlistStep4Branch;
	/** Who this signup is — read by the terminal step, which picks the confirmation CTA from it. */
	audience: WaitlistAudience;
}

// The flow claim's own signing domain — separate from the continuation token's, so neither can be
// presented as the other (the `f1` prefix differs too). Same TTL: both cover one sitting.
const FLOW_CLAIM_DOMAIN = 'darcstar:waitlist-flow:v1';
const FLOW_CLAIM_PREFIX = 'f1';
// Joins the two payload fields. Any character outside the signing core's one reserved '.' would do;
// both halves are closed vocabularies, so this can never appear inside a field.
const FLOW_CLAIM_SEPARATOR = '|';

/**
 * Sign step 2's decisions so they can survive the REST OF THE FLOW without becoming client authority.
 *
 * The step-4 fork reads `evaluation_timeline` and the confirmation CTA reads the role/application
 * audience — all answered at step 2, none of them re-asked by step 3 or step 4. Two ways to recover
 * them later, and only one is safe:
 *
 *   - Read the stored row. REJECTED: `next` (and the CTA) would then be derived from stored state,
 *     and the continuation token deliberately reaches ANY submitter of a known email (the
 *     anti-enumeration success shape). A `next: 'step4a'` would therefore prove "this address is on
 *     the list with a near-term timeline" to anyone who guesses it — an enumeration oracle the flow
 *     is built to avoid (see waitlist-steps.remote.ts' ANTI-ORACLE note).
 *   - Carry the decisions forward, signed. What this is. The claim is minted from the answers the
 *     visitor JUST gave us — nothing stored is read, so it tells the holder nothing they didn't
 *     already submit — and the MAC is what makes it non-tamperable, so a visitor cannot opt into
 *     branch A's contact-collection by editing the hidden field (DAR-63's acceptance).
 *
 * It is NOT bound to the row id, deliberately: it authorizes no write, it only chooses which
 * questions get rendered and which link the confirmation offers. Replaying someone else's claim
 * grants nothing.
 *
 * ONE claim rather than one per fact: a second signed hidden field per decision would multiply the
 * wiring at every step for no added guarantee — the MAC covers the whole payload either way.
 */
export function mintWaitlistFlowClaim(
	secret: WaitlistSigningSecret,
	state: WaitlistFlowState,
	now: number = Date.now()
): Promise<string> {
	return mintSignedValue(
		secret,
		FLOW_CLAIM_DOMAIN,
		FLOW_CLAIM_PREFIX,
		`${state.branch}${FLOW_CLAIM_SEPARATOR}${state.audience}`,
		WAITLIST_TOKEN_TTL_SECONDS,
		now
	);
}

/** A flow claim → the state it carries, or null for any failure (absent, tampered, expired). */
export async function verifyWaitlistFlowClaim(
	secret: WaitlistSigningSecret,
	claim: unknown,
	now: number = Date.now()
): Promise<WaitlistFlowState | null> {
	const payload = await verifySignedValue(secret, FLOW_CLAIM_DOMAIN, FLOW_CLAIM_PREFIX, claim, now);
	if (payload === null) return null;
	// A valid MAC over an unknown payload can't happen without the secret, but narrow anyway rather
	// than casting — the page switches on the branch, and the CTA on the audience.
	const parts = payload.split(FLOW_CLAIM_SEPARATOR);
	if (parts.length !== 2) return null;
	const [branch, audience] = parts;
	return (WAITLIST_STEP4_BRANCHES as readonly string[]).includes(branch) &&
		(WAITLIST_AUDIENCES as readonly string[]).includes(audience)
		? { branch: branch as WaitlistStep4Branch, audience: audience as WaitlistAudience }
		: null;
}

/**
 * Pick the confirmation CTA from the terminal flow state. Strictly ordered — the strongest signal
 * the visitor gave us wins:
 *
 *   1. `pilot`    — a POSITIVE step-4A pilot answer. The only CTA that opens a conversation, so it
 *                   takes the same `isPositivePilotInterest` predicate the branch-A contact block is
 *                   revealed on and `contact_permission` is gated on. Nothing else can reach it.
 *   2. `evidence` — a commercial audience without that answer: DAR-64's "technical evaluator".
 *   3. `research` — a research/education (or investor) audience: publications, never money.
 *   4. `home`     — no usable signal. The fallback, and deliberately the least-committal one: an
 *                   absent/expired/tampered flow claim arrives here as `audience: null`, and so does
 *                   anyone who skipped step 2 (a skip persists nothing, so it leaves us knowing
 *                   nothing — the epic's "general signup (skipped early)").
 *
 * The CTA is a LINK, never a summary: no branch of this decides anything the confirmation displays
 * beyond which single destination is offered. Value/budget answers are internal-only and must never
 * reach this screen.
 */
export function confirmationCtaFor(state: {
	audience: WaitlistAudience | null;
	pilotInterest?: string | null;
}): WaitlistCta {
	if (isPositivePilotInterest(state.pilotInterest ?? null)) return 'pilot';
	switch (state.audience) {
		case 'commercial':
			return 'evidence';
		case 'research':
			return 'research';
		default:
			return 'home';
	}
}

/**
 * The step a submitter goes to next. `'done'` is the terminal confirmation.
 */
export type WaitlistNextStep = 'step3' | WaitlistStep4Branch | 'done';

/**
 * Route a step-2 submission. "Skip for now" is an explicit "stop asking me things", so it always
 * terminates — even if the selects were filled before it was clicked (that submission also writes
 * nothing). Continue routes on the answers themselves: a commercial use case gets step 3 first,
 * everyone else forks straight to step 4.
 */
export function nextStepAfterStep2(submission: {
	skipped: boolean;
	role: string | null;
	primaryApplication: string | null;
	evaluationTimeline: string | null;
}): WaitlistNextStep {
	if (submission.skipped) return 'done';
	if (isCommercialUseCase(submission)) return 'step3';
	return step4BranchFor(submission.evaluationTimeline);
}

/**
 * Route a step-3 submission. Skip terminates for the same reason it does at step 2. Continue goes
 * to the branch step 2 decided and signed; an absent/tampered/expired claim falls back to B, the
 * branch that asks nothing sensitive.
 */
export function nextStepAfterStep3(submission: {
	skipped: boolean;
	branch: WaitlistStep4Branch | null;
}): WaitlistNextStep {
	if (submission.skipped) return 'done';
	return submission.branch ?? 'step4b';
}
