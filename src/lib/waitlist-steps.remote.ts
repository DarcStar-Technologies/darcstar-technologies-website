// Waitlist v2 qualification steps — the token-gated enrich endpoints for the optional flow after the
// step-1 signup (waitlist.remote.ts). Each step is its own SvelteKit remote `form`, spread onto its
// own <form> so it progressively enhances with JS and degrades to a native per-step POST without.
// Steps 2 (DAR-61) and 3 (DAR-62) live here; step 4 (DAR-63) lands alongside them.
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
// derived ONLY from the answers just submitted (waitlist-flow.ts), never from stored row state, so
// routing leaks nothing about the row either.
//
// STEP 3 IS NOT GATED AT THE WRITE. Routing past step 3 (waitlist-flow.ts) is a UX decision, not a
// permission: a non-commercial visitor who crafts a POST straight to `submitWaitlistStep3` still gets
// their answers validated + stored, because answering buys no privilege — DAR-65's classifier judges
// them by their role regardless. Re-checking the predicate here would only add a way to lose data.
import { form } from '$app/server';
import { getDb, type Db } from '$lib/server/db';
import { validateWaitlistStep2, validateWaitlistStep3 } from '$lib/server/waitlist';
import { applyWaitlistStep, type WaitlistStepData } from '$lib/server/waitlist-store';
import { verifyWaitlistToken, isDecoyWaitlistId } from '$lib/server/waitlist-token';
import { nextStepAfterStep2, type WaitlistNextStep } from '$lib/server/waitlist-flow';
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

export const submitWaitlistStep2 = form<WaitlistStep2Input, WaitlistStepResult>(
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
		// else (including "told us nothing") goes to the confirmation. Decided server-side.
		return {
			success: true,
			next: nextStepAfterStep2({
				skipped,
				role: cleaned.role,
				primaryApplication: cleaned.primaryApplication
			}),
			token: echoToken(data.token)
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

		// DAR-63 seam: step 3 forks to the step-4 branches — `evaluation_timeline` ∈ {evaluating-now,
		// within-3-months, 3-12-months} → 4A (pilot details), everything else → 4B (research
		// preferences). That routing is server-side too and plugs in here (a `nextStepAfterStep3` in
		// waitlist-flow.ts, reading the STORED timeline since step 3's form doesn't re-ask it); until
		// then both Continue and Skip terminate at the confirmation.
		return { success: true, next: 'done', token: echoToken(data.token) };
	}
);
