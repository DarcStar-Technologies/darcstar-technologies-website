// Waitlist v2 flow routing (DAR-62, DAR-63) — the single source of truth for WHICH step a submitter
// sees next: the commercial/non-commercial split that gates step 3 (which DAR-65's lead classifier
// reuses) and the step-4 A/B fork. Implemented once here rather than restated per step.
//
// Deliberately under $lib/server: the routing decision must never be client-authoritative, and
// SvelteKit's import guard makes that structural instead of a convention — a component physically
// cannot import this module. The browser learns the next step ONLY from a step endpoint's response
// (waitlist-steps.remote.ts), which derives it from the answers just submitted.
//
// No DB and no request context (the branch claim below needs only Web Crypto) → unit-tested in
// waitlist-flow.spec.ts.
//
// NOT AN AUTHORIZATION BOUNDARY. Skipping step 3 is a UX routing decision, not a permission: a
// crafted POST straight to the step-3 endpoint is still validated + stored (token permitting), and
// the classifier judges the submitter by their role either way. Answering step 3 buys no privilege,
// so nothing here needs to be re-enforced at the write. The step-4 branch claim is signed for a
// different reason — see `mintWaitlistBranchClaim`.
import type { WaitlistRole } from '$lib/waitlist-roles';
import {
	WAITLIST_V2_ROLES,
	WAITLIST_APPLICATIONS,
	type WaitlistV2Role,
	type WaitlistApplication,
	type WaitlistTimeline
} from '$lib/waitlist-qualification';
import { mintSignedValue, verifySignedValue, WAITLIST_TOKEN_TTL_SECONDS } from './waitlist-token';

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

/** The step-4 fork (DAR-63): A = pilot details, B = research/general preferences. */
export const WAITLIST_STEP4_BRANCHES = ['step4a', 'step4b'] as const;
export type WaitlistStep4Branch = (typeof WAITLIST_STEP4_BRANCHES)[number];

/** Timelines that read as active commercial interest — DAR-63's branch-A set. */
const ACTIVE_EVALUATION_TIMELINES: readonly WaitlistTimeline[] = [
	'evaluating-now',
	'within-3-months',
	'3-12-months'
];

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
	return evaluationTimeline != null &&
		(ACTIVE_EVALUATION_TIMELINES as readonly string[]).includes(evaluationTimeline)
		? 'step4a'
		: 'step4b';
}

// The branch claim's own signing domain — separate from the continuation token's, so neither can be
// presented as the other (the `b1` prefix differs too). Same TTL: both cover one sitting.
const BRANCH_CLAIM_DOMAIN = 'darcstar:waitlist-step4-branch:v1';
const BRANCH_CLAIM_PREFIX = 'b1';

/**
 * Sign a decided step-4 branch so it can survive the STEP-3 DETOUR without becoming client
 * authority.
 *
 * The fork reads `evaluation_timeline`, which is answered at step 2 — but a commercial visitor
 * passes through step 3, whose form doesn't re-ask it. Two ways to recover it at step 3, and only
 * one is safe:
 *
 *   - Read the stored row. REJECTED: `next` would then be derived from stored state, and the
 *     continuation token deliberately reaches ANY submitter of a known email (the anti-enumeration
 *     success shape). A `next: 'step4a'` would therefore prove "this address is on the list with a
 *     near-term timeline" to anyone who guesses it — an enumeration oracle the flow is built to
 *     avoid (see waitlist-steps.remote.ts' ANTI-ORACLE note).
 *   - Carry the decision forward, signed. What this is. The claim is minted from the answers the
 *     visitor JUST gave us — nothing stored is read, so it tells the holder nothing they didn't
 *     already submit — and the MAC is what makes it non-tamperable, so a visitor cannot opt into
 *     branch A's contact-collection by editing the hidden field (DAR-63's acceptance).
 *
 * It is NOT bound to the row id, deliberately: it authorizes no write, it only chooses which
 * questions get rendered. Replaying someone else's claim grants nothing.
 */
export function mintWaitlistBranchClaim(
	secret: string,
	branch: WaitlistStep4Branch,
	now: number = Date.now()
): Promise<string> {
	return mintSignedValue(
		secret,
		BRANCH_CLAIM_DOMAIN,
		BRANCH_CLAIM_PREFIX,
		branch,
		WAITLIST_TOKEN_TTL_SECONDS,
		now
	);
}

/** A branch claim → the branch it carries, or null for any failure (absent, tampered, expired). */
export async function verifyWaitlistBranchClaim(
	secret: string,
	claim: unknown,
	now: number = Date.now()
): Promise<WaitlistStep4Branch | null> {
	const branch = await verifySignedValue(
		secret,
		BRANCH_CLAIM_DOMAIN,
		BRANCH_CLAIM_PREFIX,
		claim,
		now
	);
	// A valid MAC over an unknown payload can't happen without the secret, but narrow anyway rather
	// than casting — the page switches on this value.
	return (WAITLIST_STEP4_BRANCHES as readonly string[]).includes(branch ?? '')
		? (branch as WaitlistStep4Branch)
		: null;
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
