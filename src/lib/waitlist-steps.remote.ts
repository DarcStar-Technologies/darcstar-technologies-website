// Waitlist v2 qualification steps — the token-gated enrich endpoints for the optional flow after the
// step-1 signup (waitlist.remote.ts). Each step is its own SvelteKit remote `form`, spread onto its
// own <form> so it progressively enhances with JS and degrades to a native per-step POST without.
// This file starts with step 2 (DAR-61); steps 3 and 4 (DAR-62/63) land here alongside it.
//
// AUTHORIZATION MODEL (see waitlist-token.ts + waitlist.remote.ts' SECURITY NOTE): steps 2–4 are
// UNAUTHENTICATED writes. The step-1 response hands back a signed continuation token bound to the row
// id; each step submits it back and the server verifies before enriching. The same token reaches ANY
// submitter of a known email (the anti-enumeration success shape), so the writes are deliberately
// bounded: `applyWaitlistStep` uses an explicit per-step column map (never identity, never another
// step's answers) and per-field keep-existing. This endpoint adds NO absolute overwrite of anything.
//
// ANTI-ORACLE: every path returns the identical `{ success: true }` — a bad/expired/decoy token, a
// row that no longer exists, and a real successful write are indistinguishable to the caller, matching
// the token layer's generic-null contract (verifyWaitlistToken). So a submitter can never learn from
// the response whether their token was valid or which row it addressed.
import { form } from '$app/server';
import { getDb } from '$lib/server/db';
import { validateWaitlistStep2 } from '$lib/server/waitlist';
import { applyWaitlistStep } from '$lib/server/waitlist-store';
import { verifyWaitlistToken } from '$lib/server/waitlist-token';
import { readEnv } from '$lib/server/env';

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
type WaitlistStepResult = { success: true };

export const submitWaitlistStep2 = form<WaitlistStep2Input, WaitlistStepResult>(
	'unchecked',
	async (data) => {
		// Request-scoped handles FIRST, before any await: on workerd platform.env is only valid during
		// the request and getRequestEvent() (which readEnv/getDb call) must precede the first await.
		// getDb() only CONSTRUCTS the client here (sync, no network) — the single query below is the
		// only thing that touches the DB, and it runs only on the write path.
		const db = getDb();
		const tokenSecret = readEnv('BETTER_AUTH_SECRET');

		const cleaned = validateWaitlistStep2(data);
		const hasAnswer =
			cleaned.role !== null ||
			cleaned.primaryApplication !== null ||
			cleaned.evaluationTimeline !== null;

		// Skip (the "Skip for now" button) writes nothing — the general path must not persist partial
		// junk. A Continue with every select left blank has nothing to write either; short-circuiting it
		// avoids a pointless UPDATE (and, with no DB round-trip, is what keeps the render/skip e2e
		// hermetic against the placeholder DB). All three fields are individually optional, so an
		// all-blank Continue is valid — it just advances with no enrich.
		if (data.intent !== 'skip' && hasAnswer && tokenSecret) {
			const id = await verifyWaitlistToken(tokenSecret, data.token);
			// A null id (malformed/expired/tampered/decoy token) is NOT surfaced — we simply skip the
			// write and still return the generic success below. applyWaitlistStep itself no-ops when the
			// id matches no row (deleted, or a honeypot decoy), so a stale token can't error either.
			if (id) await applyWaitlistStep(db, id, { step: 2, ...cleaned });
		}

		// DAR-62 seam: step 2's "Continue" routes to step 3 when the answers qualify as
		// commercial/operational, else to a step-4 branch/confirmation. The routing rule is defined in
		// the step-3 issue and plugs in here (returning the next step + carrying the token forward);
		// until then both Continue and Skip terminate at the confirmation the page shows on success.
		return { success: true };
	}
);
