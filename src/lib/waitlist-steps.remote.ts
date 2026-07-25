// Waitlist v2 qualification steps — the token-gated enrich endpoints for the optional flow after the
// step-1 signup (waitlist.remote.ts). Each step is its own SvelteKit remote `form`, spread onto its
// own <form> so it progressively enhances with JS and degrades to a native per-step POST without.
// Steps 2 (DAR-61), 3 (DAR-62) and both step-4 branches (DAR-63) live here.
//
// AUTHORIZATION MODEL (see waitlist-token.ts + waitlist.remote.ts' SECURITY NOTE): steps 2–4 are
// UNAUTHENTICATED writes. The step-1 response hands back a signed continuation token bound to the row
// id; each step submits it back and the server verifies before enriching. The same token reaches ANY
// submitter of a known email (the anti-enumeration success shape), so the writes are deliberately
// bounded: `applyWaitlistStep` uses an explicit per-step column map (never identity, never another
// step's answers) and per-field keep-existing. These endpoints add NO absolute overwrite of anything.
//
// ANTI-ORACLE: every path returns the identical success shape — a bad/expired/decoy token, a row that
// no longer exists, and a real successful write are indistinguishable to the caller, matching the
// token layer's generic-null contract (verifyWaitlistToken). The `next` step in the response is
// derived ONLY from the answers just submitted (waitlist-flow.ts, plus step 2's signed branch claim),
// NEVER from stored row state — the token reaches any submitter of a known email, so a `next` that
// depended on the row would leak whether that address is on the list, and how it answered.
//
// THE ROUTING IS NOT GATED AT THE WRITE. Which step a visitor is shown (waitlist-flow.ts) is a UX
// decision, not a permission: someone who crafts a POST straight to step 3 — or to the step-4 branch
// they weren't routed to — still gets their answers validated + stored, because answering buys no
// privilege; DAR-65's classifier judges them by their answers regardless. Re-checking the predicate
// here would only add a way to lose data. The one thing that IS re-decided server-side at the write
// is step 4A's `contact_permission`, which the validator gates on the pilot answer so a grant can
// only be recorded from a question that was actually on screen.
import { form } from '$app/server';
import { getDb, type Db } from '$lib/server/db';
import {
	validateWaitlistStep2,
	validateWaitlistStep3,
	validateWaitlistStep4A,
	validateWaitlistStep4B
} from '$lib/server/waitlist';
import { applyWaitlistStep, type WaitlistStepData } from '$lib/server/waitlist-store';
import { verifyWaitlistToken, isDecoyWaitlistId } from '$lib/server/waitlist-token';
import {
	nextStepAfterStep2,
	nextStepAfterStep3,
	step4BranchFor,
	mintWaitlistBranchClaim,
	verifyWaitlistBranchClaim,
	type WaitlistNextStep
} from '$lib/server/waitlist-flow';
import { readEnv } from '$lib/server/env';

/**
 * Every step returns this shape.
 *
 * - `next` tells the page which step to render (or `'done'` for the confirmation). The rule lives
 *   server-side in waitlist-flow.ts; the client only obeys the answer.
 * - `token` echoes the submitted continuation token so the NEXT step's hidden field survives a no-JS
 *   re-render — after a native per-step POST the step-1 result is long gone. It's the caller's own
 *   input, reflected verbatim and never re-minted, so no path can hand out a token the caller didn't
 *   already hold; an invalid one simply fails verification at the next step too.
 */
type WaitlistStepResult = { success: true; next: WaitlistNextStep; token: string };

/**
 * Step 2 additionally hands back the SIGNED step-4 branch (waitlist-flow.ts), which step 3's form
 * carries as a hidden field. Step 3 doesn't re-ask the evaluation timeline the fork reads, and
 * recovering it from the stored row would turn `next` into an enumeration oracle — see
 * `mintWaitlistBranchClaim` for the full reasoning. Empty when the signing secret is missing (the
 * flow still runs; step 3 then falls back to branch B).
 */
type WaitlistStep2Result = WaitlistStepResult & { branchClaim: string };

// A real token is ~100 chars; cap the echo so a junk submission can't have its payload reflected back
// wholesale. Over-length is truncated (and then fails verification) rather than rejected — rejecting
// would be a response shape the anti-oracle contract doesn't allow.
const TOKEN_ECHO_MAX = 256;
const echoToken = (v: unknown): string => (typeof v === 'string' ? v.slice(0, TOKEN_ECHO_MAX) : '');

/**
 * Verify the continuation token and apply one step's columns. BEST EFFORT — never throws:
 *
 * The signup row was already persisted at step 1 and these steps are optional enrichment, so a DB
 * failure must not break the visitor's flow with an error page (the same posture as the fire-and-
 * forget notification emails: log it, don't fail the submission). A verification failure is likewise
 * silent — surfacing it would turn the response into a token oracle.
 */
async function applyStepBestEffort(
	db: Db,
	tokenSecret: string | undefined,
	token: unknown,
	data: WaitlistStepData
): Promise<void> {
	if (!tokenSecret) return; // misconfigured env: the flow still works, it just can't enrich
	try {
		const id = await verifyWaitlistToken(tokenSecret, token);
		// A null id (malformed/expired/tampered) is not surfaced — skip the write. A DECOY id (the
		// honeypot's token) is skipped too: it addresses no real row, so the UPDATE could only match
		// zero rows, and a trap-tripping bot shouldn't get to spend DB writes. Both look identical to
		// the caller. applyWaitlistStep also no-ops on an id whose row is simply gone.
		if (id && !isDecoyWaitlistId(id)) await applyWaitlistStep(db, id, data);
	} catch (err) {
		console.error('waitlist step enrich failed', data.step, err);
	}
}

// `token` is the continuation handle from step 1; `intent` discriminates the two submit buttons
// (Continue writes the answers; "Skip for now" persists nothing). The three answer fields back the
// GlassSelects and are each individually optional even on Continue.
type WaitlistStep2Input = {
	token: string;
	intent: string;
	role: string;
	primaryApplication: string;
	evaluationTimeline: string;
};

export const submitWaitlistStep2 = form<WaitlistStep2Input, WaitlistStep2Result>(
	'unchecked',
	async (data) => {
		// Request-scoped handles FIRST, before any await: on workerd platform.env is only valid during
		// the request and getRequestEvent() (which readEnv/getDb call) must precede the first await.
		// getDb() only CONSTRUCTS the client here (sync, no network) — the enrich below is the only
		// thing that touches the DB, and it runs only on the write path.
		const db = getDb();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep2(data);
		const skipped = data.intent === 'skip';
		const hasAnswer =
			cleaned.role !== null ||
			cleaned.primaryApplication !== null ||
			cleaned.evaluationTimeline !== null;

		// Skip (the "Skip for now" button) writes nothing — the general path must not persist partial
		// junk. A Continue with every select left blank has nothing to write either; short-circuiting it
		// avoids a pointless UPDATE (and, with no DB round-trip, is what keeps the render/skip e2e
		// hermetic against the placeholder DB). All three fields are individually optional, so an
		// all-blank Continue is valid — it just advances with no enrich.
		if (!skipped && hasAnswer) {
			await applyStepBestEffort(db, tokenSecret, data.token, { step: 2, ...cleaned });
		}

		// Route on the answers just submitted: commercial/operational use cases get step 3, everyone
		// else forks straight to a step-4 branch. Decided server-side, never from stored state.
		//
		// The branch claim is minted on EVERY path (not just the step-3 one) so the response shape
		// doesn't vary, and it costs one HMAC. It carries only what the visitor just told us.
		return {
			success: true,
			next: nextStepAfterStep2({
				skipped,
				role: cleaned.role,
				primaryApplication: cleaned.primaryApplication,
				evaluationTimeline: cleaned.evaluationTimeline
			}),
			token: echoToken(data.token),
			branchClaim: tokenSecret
				? await mintWaitlistBranchClaim(tokenSecret, step4BranchFor(cleaned.evaluationTimeline))
				: ''
		};
	}
);

// Step 3's answers: three single-selects plus the capped multi-select. `adoptionEvidence` is an ARRAY
// field — its checkboxes are named `adoptionEvidence[]` (Kit's `.as('checkbox', value)` adds the
// suffix), which is required: a repeated plain name throws in SvelteKit's form-data conversion. With
// nothing checked the key is absent, and the validator reads that as "no answer".
type WaitlistStep3Input = {
	token: string;
	intent: string;
	/** The signed step-4 branch step 2 decided — carried through, never re-derived here. */
	branchClaim: string;
	currentApproach: string;
	economicImpact: string;
	budgetRange: string;
	adoptionEvidence: string[];
};

export const submitWaitlistStep3 = form<WaitlistStep3Input, WaitlistStepResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles first — see the note in submitWaitlistStep2.
		const db = getDb();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep3(data);
		const skipped = data.intent === 'skip';
		const hasAnswer =
			cleaned.currentApproach !== null ||
			cleaned.economicImpact !== null ||
			cleaned.budgetRange !== null ||
			cleaned.adoptionEvidence !== null;

		// Same rule as step 2: Skip persists nothing, and an all-blank Continue has nothing to enrich.
		// The evidence cap is applied inside the validator, so more than WAITLIST_EVIDENCE_MAX boxes
		// (JS off, or the disabling bypassed) is truncated rather than rejected.
		if (!skipped && hasAnswer) {
			await applyStepBestEffort(db, tokenSecret, data.token, { step: 3, ...cleaned });
		}

		// The step-4 fork was decided at step 2 (from the evaluation timeline, which this form doesn't
		// re-ask) and signed; verify it rather than trusting the hidden field, and rather than reading
		// the stored row — see mintWaitlistBranchClaim for why the stored read would be an oracle. An
		// absent/tampered claim falls back to branch B, which asks nothing sensitive.
		const branch = tokenSecret
			? await verifyWaitlistBranchClaim(tokenSecret, data.branchClaim)
			: null;

		return {
			success: true,
			next: nextStepAfterStep3({ skipped, branch }),
			token: echoToken(data.token)
		};
	}
);

// Step 4A (DAR-63) — active commercial interest. `pilotInterest` is the gate: the contact block
// (deployment scale / permission / method / phone) is only RENDERED for a positive answer, and the
// validator independently decides on the same predicate whether `contactPermission` is a real answer
// or "never asked" (null), so a crafted POST can't record a grant that was never on screen.
type WaitlistStep4AInput = {
	token: string;
	intent: string;
	pilotInterest: string;
	deploymentScale: string;
	contactPermission: boolean; // typed boolean so the markup can use `.as('checkbox')`
	contactMethod: string;
	phone: string;
};

export const submitWaitlistStep4A = form<WaitlistStep4AInput, WaitlistStepResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles first — see the note in submitWaitlistStep2.
		const db = getDb();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep4A(data);
		const skipped = data.intent === 'skip';
		const hasAnswer =
			cleaned.pilotInterest !== null ||
			cleaned.deploymentScale !== null ||
			cleaned.contactPermission !== null ||
			cleaned.contactMethod !== null ||
			cleaned.phone !== null;

		// Same rule as steps 2–3: Skip persists nothing, an all-blank Continue has nothing to enrich.
		if (!skipped && hasAnswer) {
			await applyStepBestEffort(db, tokenSecret, data.token, { step: '4a', ...cleaned });
		}

		// Terminal step — both buttons land on the confirmation.
		return { success: true, next: 'done', token: echoToken(data.token) };
	}
);

// Step 4B (DAR-63) — research / general interest. One uncapped multi-select, and deliberately no
// budget, pilot or contact-permission question. `researchPreferences[]` is an ARRAY field (the same
// `foo[]` wire contract step 3's evidence group follows).
type WaitlistStep4BInput = {
	token: string;
	intent: string;
	researchPreferences: string[];
};

export const submitWaitlistStep4B = form<WaitlistStep4BInput, WaitlistStepResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles first — see the note in submitWaitlistStep2.
		const db = getDb();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep4B(data);
		const skipped = data.intent === 'skip';

		if (!skipped && cleaned.researchPreferences !== null) {
			await applyStepBestEffort(db, tokenSecret, data.token, { step: '4b', ...cleaned });
		}

		return { success: true, next: 'done', token: echoToken(data.token) };
	}
);
