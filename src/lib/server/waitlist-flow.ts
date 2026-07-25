// Waitlist v2 flow routing (DAR-62) — the single source of truth for WHICH step a submitter sees
// next, and for the commercial/non-commercial split that DAR-63's step-4 branch and DAR-65's lead
// classifier reuse. Implemented once here rather than three times.
//
// Deliberately under $lib/server: the routing decision must never be client-authoritative, and
// SvelteKit's import guard makes that structural instead of a convention — a component physically
// cannot import this module. The browser learns the next step ONLY from a step endpoint's response
// (waitlist-steps.remote.ts), which derives it from the answers just submitted.
//
// Pure module (no DB, no request context) → unit-tested in waitlist-flow.spec.ts.
//
// NOT AN AUTHORIZATION BOUNDARY. Skipping step 3 is a UX routing decision, not a permission: a
// crafted POST straight to the step-3 endpoint is still validated + stored (token permitting), and
// the classifier judges the submitter by their role either way. Answering step 3 buys no privilege,
// so nothing here needs to be re-enforced at the write.
import type { WaitlistRole } from '$lib/waitlist-roles';
import {
	WAITLIST_V2_ROLES,
	WAITLIST_APPLICATIONS,
	type WaitlistV2Role,
	type WaitlistApplication
} from '$lib/waitlist-qualification';

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
 * The step a submitter goes to next. `'done'` is the terminal confirmation; DAR-63 replaces it for
 * the step-4 fork (`'step4a'`/`'step4b'`) and adds the after-step-3 routing.
 */
export type WaitlistNextStep = 'step3' | 'done';

/**
 * Route a step-2 submission. "Skip for now" is an explicit "stop asking me things", so it always
 * terminates — even if the selects were filled before it was clicked (that submission also writes
 * nothing). Continue routes on the answers themselves.
 */
export function nextStepAfterStep2(submission: {
	skipped: boolean;
	role: string | null;
	primaryApplication: string | null;
}): WaitlistNextStep {
	if (submission.skipped) return 'done';
	return isCommercialUseCase(submission) ? 'step3' : 'done';
}
