// Waitlist v2 qualification steps — the token-gated enrich endpoints for the optional flow after the
// step-1 signup (waitlist.remote.ts). Each step is its own SvelteKit remote `form`, spread onto its
// own <form> so it progressively enhances with JS and degrades to a native per-step POST without.
// Steps 2 (DAR-61), 3 (DAR-62) and both step-4 branches (DAR-63) live here; whichever of them ends
// the flow also picks the confirmation's CTA (DAR-64).
//
// AUTHORIZATION MODEL (see waitlist-token.ts + waitlist.remote.ts): steps 2–4 are UNAUTHENTICATED
// writes. Step 1's response hands back a signed continuation token bound to the SUBMISSION it just
// inserted; each step submits it back and the server verifies before enriching. Since DAR-88 that is
// the whole boundary: signups are append-only, so a token always addresses the row its own holder
// created, and the worst a holder can do is edit answers they gave themselves. The per-step column
// maps in `applyWaitlistStep` stay — they keep a step to its own columns and away from identity — but
// they are legibility and blast-radius now, not the thing standing between an attacker and a
// stranger's record. (Before DAR-88 a token could be minted against a row someone ELSE created, which
// is what DAR-59's per-field policies and DAR-72's phone/permission rules existed to contain.)
//
// ANTI-ORACLE: every path returns the identical success shape — a bad/expired/decoy token, a row that
// no longer exists, and a real successful write are indistinguishable to the caller, matching the
// token layer's generic-null contract (verifyWaitlistToken). The `next` step in the response — and
// the terminal `cta` — are derived ONLY from the answers just submitted (waitlist-flow.ts, plus step
// 2's signed flow claim), NEVER from stored row state. Keep it that way even though DAR-88 defused the
// enumeration angle: reading the row to route would still make the response depend on data the visitor
// can't see, and the flow claim already carries everything the routing needs.
//
// EVERY STEP ALSO MOVES THE RESUME COOKIE (DAR-75) on to whatever it just routed to, from the SAME
// `next` the response carries — so a reload lands where the visitor left off instead of on a blank
// signup form, and the cookie can never disagree with the page about where that is. It is signed and
// httpOnly (waitlist-resume.ts) and drops the row id at `done`.
//
// THE ROUTING IS NOT GATED AT THE WRITE. Which step a visitor is shown (waitlist-flow.ts) is a UX
// decision, not a permission: someone who crafts a POST straight to step 3 — or to the step-4 branch
// they weren't routed to — still gets their answers validated + stored, because answering buys no
// privilege; DAR-65's classifier judges them by their answers regardless. Re-checking the predicate
// here would only add a way to lose data. The one thing that IS re-decided server-side at the write
// is step 4A's `contact_permission`, which the validator gates on the pilot answer so a grant can
// only be recorded from a question that was actually on screen.
import { form, getRequestEvent } from '$app/server';
import { getDb, type Db } from '$lib/server/db';
import { captureWaitlistFunnel } from '$lib/server/waitlist-funnel';
import { echoFlowId, type WaitlistFunnelEvent } from '$lib/waitlist-funnel';
import {
	hasAnyAnswer,
	validateWaitlistStep2,
	validateWaitlistStep3,
	validateWaitlistStep4A,
	validateWaitlistStep4B
} from '$lib/server/waitlist';
import { applyWaitlistStep, type WaitlistStepData } from '$lib/server/waitlist-store';
import { verifyWaitlistToken, isDecoyWaitlistId } from '$lib/server/waitlist-token';
import { setWaitlistResume, type WaitlistResumeStage } from '$lib/server/waitlist-resume';
import {
	nextStepAfterStep2,
	nextStepAfterStep3,
	step4BranchFor,
	audienceFor,
	confirmationCtaFor,
	mintWaitlistFlowClaim,
	verifyWaitlistFlowClaim,
	type WaitlistAudience,
	type WaitlistNextStep,
	type WaitlistStep4Branch
} from '$lib/server/waitlist-flow';
import type { WaitlistCta } from '$lib/waitlist-qualification';
import { readEnv } from '$lib/server/env';
import type { Cookies } from '@sveltejs/kit';

/**
 * Every step returns this shape.
 *
 * - `next` tells the page which step to render (or `'done'` for the confirmation). The rule lives
 *   server-side in waitlist-flow.ts; the client only obeys the answer.
 * - `token` echoes the submitted continuation token so the NEXT step's hidden field survives a no-JS
 *   re-render — after a native per-step POST the step-1 result is long gone. It's the caller's own
 *   input, reflected verbatim and never re-minted, so no path can hand out a token the caller didn't
 *   already hold; an invalid one simply fails verification at the next step too.
 * - `cta` is the confirmation's personalized call to action (DAR-64), non-null exactly when this
 *   response terminates the flow. Chosen server-side from the same flow state that routes the steps,
 *   so the page renders a decision rather than making one; it names a DESTINATION and never echoes
 *   an answer.
 * - `flowId` echoes the submitted funnel handle (DAR-66) for exactly the reason `token` does — a
 *   no-JS step POST re-renders the page, whose load mints a fresh id — so one visitor stays one flow.
 *   Validated on the way out (`echoFlowId`), never re-minted.
 */
type WaitlistStepResult = {
	success: true;
	next: WaitlistNextStep;
	token: string;
	cta: WaitlistCta | null;
	flowId: string;
};

/**
 * Steps 2 and 3 additionally carry the SIGNED flow claim (waitlist-flow.ts) — step 2 mints it, step 3
 * echoes it verbatim — because the decisions inside it (the step-4 branch, the CTA audience) are
 * settled by the step-2 answers and never re-asked afterwards. Recovering them from the stored row
 * would turn `next` into an enumeration oracle; see `mintWaitlistFlowClaim` for the full reasoning.
 * Empty when the signing secret is missing (the flow still runs, and falls back to branch B + the
 * least-committal CTA).
 */
type WaitlistCarryingResult = WaitlistStepResult & { flowClaim: string };

// Reflect a signed value (the continuation token, the flow claim) back to the caller so the next
// step's hidden field survives a no-JS re-render. A real one is ~100 chars; cap the echo so a junk
// submission can't have its payload reflected back wholesale. Over-length is truncated (and then
// fails verification) rather than rejected — rejecting would be a response shape the anti-oracle
// contract doesn't allow.
const SIGNED_ECHO_MAX = 256;
const echoSigned = (v: unknown): string =>
	typeof v === 'string' ? v.slice(0, SIGNED_ECHO_MAX) : '';

/**
 * The submission the presented token authorizes, or null for ANY failure (no secret, malformed,
 * expired, tampered, or a value signed for something else). Never throws.
 *
 * Resolved ONCE per step rather than inside the enrich, because two things want it now: the write
 * below, and the resume cookie (DAR-75), which stores the row id so a reload can re-mint a token for
 * it. A DECOY id (the honeypot's) comes back as-is — the caller decides what to do with it, and the
 * two callers differ: the enrich skips it, the cookie keeps it so the trap's responses stay
 * byte-identical to a real signup's.
 */
async function resolveStepRow(tokenSecret: string | undefined, token: unknown) {
	if (!tokenSecret) return null; // misconfigured env: the flow still works, it just can't enrich
	try {
		return await verifyWaitlistToken(tokenSecret, token);
	} catch (err) {
		console.error('waitlist step token verification failed', err);
		return null;
	}
}

/**
 * Apply one step's columns to an already-resolved row. BEST EFFORT — never throws:
 *
 * The signup row was already persisted at step 1 and these steps are optional enrichment, so a DB
 * failure must not break the visitor's flow with an error page (the same posture as the fire-and-
 * forget notification emails: log it, don't fail the submission). An unusable token is likewise
 * silent — surfacing it would turn the response into a token oracle.
 */
async function applyStepBestEffort(
	db: Db,
	rowId: string | null,
	data: WaitlistStepData
): Promise<void> {
	// A null id (malformed/expired/tampered/no secret) is not surfaced — skip the write. A DECOY id
	// (the honeypot's token) is skipped too: it addresses no real row, so the UPDATE could only match
	// zero rows, and a trap-tripping bot shouldn't get to spend DB writes. Both look identical to the
	// caller. applyWaitlistStep also no-ops on an id whose row is simply gone.
	if (!rowId || isDecoyWaitlistId(rowId)) return;
	try {
		await applyWaitlistStep(db, rowId, data);
	} catch (err) {
		console.error('waitlist step enrich failed', data.step, err);
	}
}

/**
 * Move the resume cookie (DAR-75) on to whatever step the server just routed to, so a reload lands
 * there instead of on a blank signup form.
 *
 * `next` is the SAME value the response carries, which is what keeps the two in step: the cookie can
 * never disagree with the page about where the visitor is, because both read one decision.
 *
 * THE ROW ID IS DROPPED AT `done`. A finished flow has nothing left to write, so its cookie stops
 * carrying a handle that could be turned back into a write token — see `WaitlistResumeState`.
 */
function rememberStep(
	cookies: Cookies,
	tokenSecret: string | undefined,
	rowId: string | null,
	state: {
		// Assignable as-is: `WaitlistNextStep` is `WaitlistResumeStage` minus `step2`, which only
		// step 1 routes to. A new next-step slug is a type error here until it's a resumable one.
		next: WaitlistResumeStage;
		branch: WaitlistStep4Branch | null;
		audience: WaitlistAudience | null;
		cta: WaitlistCta | null;
		flowId: string;
	}
): Promise<void> {
	return setWaitlistResume(cookies, tokenSecret, {
		stage: state.next,
		submissionId: state.next === 'done' ? null : rowId,
		branch: state.branch,
		audience: state.audience,
		cta: state.cta,
		flowId: state.flowId
	});
}

// `token` is the continuation handle from step 1; `intent` discriminates the two submit buttons
// (Continue writes the answers; "Skip for now" persists nothing). The three answer fields back the
// GlassSelects and are each individually optional even on Continue.
type WaitlistStep2Input = {
	token: string;
	intent: string;
	/** Funnel handle (DAR-66) — anonymous, carried through the flow, never stored on the signup row. */
	flowId: string;
	role: string;
	primaryApplication: string;
	evaluationTimeline: string;
};

export const submitWaitlistStep2 = form<WaitlistStep2Input, WaitlistCarryingResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles FIRST, before any await: on workerd platform.env is only valid during
		// the request and getRequestEvent() (which readEnv/getDb call) must precede the first await.
		// getDb() only CONSTRUCTS the client here (sync, no network) — the enrich below is the only
		// thing that touches the DB, and it runs only on the write path.
		const db = getDb();
		const { platform, cookies } = getRequestEvent();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep2(data);
		const skipped = data.intent === 'skip';
		const hasAnswer = hasAnyAnswer(cleaned);
		const rowId = await resolveStepRow(tokenSecret, data.token);

		// Skip (the "Skip for now" button) writes nothing — the general path must not persist partial
		// junk. A Continue with every select left blank has nothing to write either; short-circuiting it
		// avoids a pointless UPDATE (and, with no DB round-trip, is what keeps the render/skip e2e
		// hermetic against the placeholder DB). All three fields are individually optional, so an
		// all-blank Continue is valid — it just advances with no enrich.
		if (!skipped && hasAnswer) {
			await applyStepBestEffort(db, rowId, { step: 2, ...cleaned });
		}

		// Route on the answers just submitted: commercial/operational use cases get step 3, everyone
		// else forks straight to a step-4 branch. Decided server-side, never from stored state.
		const next = nextStepAfterStep2({
			skipped,
			role: cleaned.role,
			primaryApplication: cleaned.primaryApplication,
			evaluationTimeline: cleaned.evaluationTimeline
		});

		// Funnel (DAR-66). `qualification_started` fires for EITHER button — reaching this endpoint at
		// all is the visitor engaging with the optional flow, and the gap between it and
		// `waitlist_signup_completed` is therefore the people who were shown step 2 and never touched
		// it, which is the drop-off worth knowing. `use_case_completed` is the narrower claim: they
		// pressed Continue AND answered something. A Skip fires the first and not the second, which is
		// the whole distinction between the two slugs.
		const events: WaitlistFunnelEvent[] = ['qualification_started'];
		if (!skipped && hasAnswer) events.push('use_case_completed');
		if (next === 'done') events.push('qualification_completed');
		captureWaitlistFunnel(db, platform, data.flowId, events);

		// Step 2 only terminates by SKIP, which persists nothing — so it leaves us knowing nothing, and
		// `audience: null` is the honest input (DAR-64's "general signup, skipped early"). On every
		// other path the flow continues and a later step picks the CTA.
		const cta = skipped ? confirmationCtaFor({ audience: null }) : null;

		// The two decisions step 2 settles. They ride BOTH the signed flow claim (forward, to whichever
		// step asks next) and the resume cookie (sideways, to a reload) — computed once here so the two
		// transports can never carry different answers.
		//
		// A skip stores nothing, so its resume state carries nothing either: the `null`s below are the
		// same "we know nothing about them" the CTA above is chosen from.
		const branch = step4BranchFor(cleaned.evaluationTimeline);
		const audience = audienceFor(cleaned);
		const flowId = echoFlowId(data.flowId);
		await rememberStep(cookies, tokenSecret, rowId, {
			next,
			branch: skipped ? null : branch,
			audience: skipped ? null : audience,
			cta,
			flowId
		});

		// The flow claim is minted on EVERY path (not just the step-3 one) so the response shape
		// doesn't vary, and it costs one HMAC. It carries only what the visitor just told us.
		return {
			success: true,
			next,
			token: echoSigned(data.token),
			flowId,
			flowClaim: tokenSecret ? await mintWaitlistFlowClaim(tokenSecret, { branch, audience }) : '',
			cta
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
	/** The signed step-2 decisions (branch + CTA audience) — carried through, never re-derived here. */
	flowClaim: string;
	/** Funnel handle (DAR-66) — anonymous, carried through the flow, never stored on the signup row. */
	flowId: string;
	currentApproach: string;
	economicImpact: string;
	budgetRange: string;
	adoptionEvidence: string[];
};

export const submitWaitlistStep3 = form<WaitlistStep3Input, WaitlistCarryingResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles first — see the note in submitWaitlistStep2.
		const db = getDb();
		const { platform, cookies } = getRequestEvent();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep3(data);
		const skipped = data.intent === 'skip';
		const hasAnswer = hasAnyAnswer(cleaned);
		const rowId = await resolveStepRow(tokenSecret, data.token);

		// Same rule as step 2: Skip persists nothing, and an all-blank Continue has nothing to enrich.
		// The evidence cap is applied inside the validator, so more than WAITLIST_EVIDENCE_MAX boxes
		// (JS off, or the disabling bypassed) is truncated rather than rejected.
		if (!skipped && hasAnswer) {
			await applyStepBestEffort(db, rowId, { step: 3, ...cleaned });
		}

		// The step-4 fork and the CTA audience were decided at step 2 (from answers this form doesn't
		// re-ask) and signed; verify rather than trusting the hidden field, and rather than reading the
		// stored row — see mintWaitlistFlowClaim for why the stored read would be an oracle. An
		// absent/tampered claim falls back to branch B, which asks nothing sensitive, and to the
		// least-committal CTA.
		const flow = tokenSecret ? await verifyWaitlistFlowClaim(tokenSecret, data.flowClaim) : null;
		const next = nextStepAfterStep3({ skipped, branch: flow?.branch ?? null });

		// Funnel (DAR-66). Only the money questions being ANSWERED counts as commercial context — a
		// Skip through step 3 is the opposite signal. No answer VALUE is recorded, here or anywhere:
		// the event says the stage was reached, never what was in it.
		const events: WaitlistFunnelEvent[] = [];
		if (!skipped && hasAnswer) events.push('commercial_context_completed');
		if (next === 'done') events.push('qualification_completed');
		captureWaitlistFunnel(db, platform, data.flowId, events);

		// Step 3 terminates by SKIP only. Skipping the money questions doesn't unlearn who they told us
		// they were at step 2, so the audience still stands.
		const cta = next === 'done' ? confirmationCtaFor({ audience: flow?.audience ?? null }) : null;

		// Carry step 2's decisions sideways as well as forward — the resume cookie is the only copy a
		// RELOAD can reach, since the claim itself lives in a hidden field that a fresh GET doesn't
		// have. Same verified values the routing above used, never a re-derivation.
		const flowId = echoFlowId(data.flowId);
		await rememberStep(cookies, tokenSecret, rowId, {
			next,
			branch: flow?.branch ?? null,
			audience: flow?.audience ?? null,
			cta,
			flowId
		});

		return {
			success: true,
			next,
			token: echoSigned(data.token),
			flowId,
			// Echoed verbatim, like the token: step 4's hidden field has to survive a no-JS re-render,
			// and re-minting here would be a second place that decides what the claim says.
			flowClaim: echoSigned(data.flowClaim),
			cta
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
	/** Carried from step 2 (via step 3 when there was one) — read for the CTA audience, nothing else. */
	flowClaim: string;
	/** Funnel handle (DAR-66) — anonymous, carried through the flow, never stored on the signup row. */
	flowId: string;
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
		const { platform, cookies } = getRequestEvent();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep4A(data);
		const skipped = data.intent === 'skip';
		const hasAnswer = hasAnyAnswer(cleaned);
		const rowId = await resolveStepRow(tokenSecret, data.token);

		// Same rule as steps 2–3: Skip persists nothing, an all-blank Continue has nothing to enrich.
		if (!skipped && hasAnswer) {
			await applyStepBestEffort(db, rowId, { step: '4a', ...cleaned });
		}

		// Terminal step — both buttons land on the confirmation, so the CTA is decided here (DAR-64).
		// It reads the VALIDATED pilot answer, so a tampered slug is no answer at all; and it reads it
		// only on Continue, because a Skip stores nothing and must not be treated as having said yes.
		// The audience behind it comes from step 2's signed claim, never from a stored read.
		const flow = tokenSecret ? await verifyWaitlistFlowClaim(tokenSecret, data.flowClaim) : null;

		// Funnel (DAR-66). `pilot_interest_selected` records that the pilot question was ANSWERED —
		// with the validated slug, so a tampered value is no answer — and deliberately not WHICH
		// answer: `not-currently` is as much a completed question as a yes, and the split between them
		// is what DAR-65's classifier and the row detail are for. A Skip answered nothing.
		const events: WaitlistFunnelEvent[] = [];
		if (!skipped && cleaned.pilotInterest !== null) events.push('pilot_interest_selected');
		events.push('qualification_completed'); // terminal step: both buttons land on the confirmation
		captureWaitlistFunnel(db, platform, data.flowId, events);

		const cta = confirmationCtaFor({
			audience: flow?.audience ?? null,
			pilotInterest: skipped ? null : cleaned.pilotInterest
		});

		// Terminal: the cookie now holds a screen and a link and nothing else — `rememberStep` drops
		// the row id at `done`, so a reload of the confirmation can't re-mint a write token. The
		// RESOLVED cta is stored rather than the pilot answer it came from, both because it's the only
		// thing the confirmation renders and because an answer has no business in a cookie.
		const flowId = echoFlowId(data.flowId);
		await rememberStep(cookies, tokenSecret, rowId, {
			next: 'done',
			branch: null,
			audience: null,
			cta,
			flowId
		});

		return {
			success: true,
			next: 'done',
			token: echoSigned(data.token),
			flowId,
			cta
		};
	}
);

// Step 4B (DAR-63) — research / general interest. One uncapped multi-select, and deliberately no
// budget, pilot or contact-permission question. `researchPreferences[]` is an ARRAY field (the same
// `foo[]` wire contract step 3's evidence group follows).
type WaitlistStep4BInput = {
	token: string;
	intent: string;
	/** Carried from step 2 (via step 3 when there was one) — read for the CTA audience, nothing else. */
	flowClaim: string;
	/** Funnel handle (DAR-66) — anonymous, carried through the flow, never stored on the signup row. */
	flowId: string;
	researchPreferences: string[];
};

export const submitWaitlistStep4B = form<WaitlistStep4BInput, WaitlistStepResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles first — see the note in submitWaitlistStep2.
		const db = getDb();
		const { platform, cookies } = getRequestEvent();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep4B(data);
		const skipped = data.intent === 'skip';
		const rowId = await resolveStepRow(tokenSecret, data.token);

		if (!skipped && hasAnyAnswer(cleaned)) {
			await applyStepBestEffort(db, rowId, { step: '4b', ...cleaned });
		}

		// Terminal step. Branch B never asks about pilots, so the CTA rests on the step-2 audience
		// alone — and `pilot` is unreachable from here, which is the point: this branch is for people
		// we decided not to ask for a conversation.
		const flow = tokenSecret ? await verifyWaitlistFlowClaim(tokenSecret, data.flowClaim) : null;

		// Funnel (DAR-66): terminal step, so the flow completed either way. No branch-B-specific event
		// exists — `pilot_interest_selected` is branch A's, and this branch is never asked.
		captureWaitlistFunnel(db, platform, data.flowId, ['qualification_completed']);

		const cta = confirmationCtaFor({ audience: flow?.audience ?? null });

		// Terminal, same as branch A: the row id is dropped and the cookie keeps only the screen and
		// its link.
		const flowId = echoFlowId(data.flowId);
		await rememberStep(cookies, tokenSecret, rowId, {
			next: 'done',
			branch: null,
			audience: null,
			cta,
			flowId
		});

		return {
			success: true,
			next: 'done',
			token: echoSigned(data.token),
			flowId,
			cta
		};
	}
);
