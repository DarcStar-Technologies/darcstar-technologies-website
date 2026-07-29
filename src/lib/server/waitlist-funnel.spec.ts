import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { getTableColumns } from 'drizzle-orm';
import * as schema from './db/schema';
import { waitlistFunnelEvent } from './db/schema';
import type { Db } from './db';
import {
	captureWaitlistFunnel,
	captureWaitlistStepFunnel,
	mintWaitlistFlowId,
	newWaitlistFlowId,
	readWaitlistFunnelCounts,
	resolveWaitlistFlowId,
	signupConversionRate,
	verifyWaitlistFlowId,
	WAITLIST_FLOW_ID_TTL_SECONDS,
	type WaitlistFunnelCounts
} from './waitlist-funnel';
import {
	decoyWaitlistId,
	mintWaitlistToken,
	verifyWaitlistToken,
	WAITLIST_TOKEN_TTL_SECONDS
} from './waitlist-token';
import {
	WAITLIST_FUNNEL_EVENTS,
	isWaitlistFlowId,
	type WaitlistFlowId,
	type WaitlistFunnelEvent
} from '$lib/waitlist-funnel';
import type { WaitlistSigningSecret } from './waitlist-secret';
import {
	appSourcePaths,
	importedNames,
	importsDynamically,
	importsNamespace,
	sourceText
} from './source-scan';

// The funnel write path (DAR-66), against a real in-memory libsql — because the two properties worth
// testing are both properties of the DATABASE, not of the TypeScript: the composite primary key is
// what caps a flow's rows, and `onConflictDoNothing` is what makes a replayed submit a no-op instead
// of an error. A mocked client would assert the SQL I wrote rather than what SQLite does with it.
const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema }) as unknown as Db;

// `captureWaitlistFunnel` returns void — that IS its contract, so nothing can accidentally await
// analytics. The seam for a test is `ctx.waitUntil`, which is also how the write survives on
// workerd: collect what it hands over, then drain.
const inflight: Promise<unknown>[] = [];
const platform = {
	ctx: { waitUntil: (promise: Promise<unknown>) => inflight.push(promise) }
} as unknown as App.Platform;
const flush = () => Promise.all(inflight.splice(0));

const rows = () =>
	db
		.select({ flowId: waitlistFunnelEvent.flowId, event: waitlistFunnelEvent.event })
		.from(waitlistFunnelEvent);

// The signing secret every handle below is minted with. Any string works — what matters is that the
// handles are the real thing the load mints rather than hand-written `n1.…` strings.
// Branded since DAR-99: production earns a signing secret from `waitlistSigningSecret()`, the one
// resolver every mint and verify now takes its key from. A fixture has no request to read, so the
// cast is the honest way to state one — the same shape `WaitlistFlowId`'s fixtures use.
const SECRET = 'spec-secret-not-a-real-one' as WaitlistSigningSecret;
/** Another deployment's secret — same brand, different bytes. Nothing minted under it may verify here. */
const OTHER_SECRET = 'a-different-deployments-secret' as WaitlistSigningSecret;

// The two forms a flow id takes since DAR-86: the BARE id — branded, what the capture takes and what
// the column holds — and the signed HANDLE that carries it on the wire. The casts are the honest way
// to state a fixture; production code earns a branded id from `newWaitlistFlowId` or a signature.
const FLOW = '3f2504e0-4f89-41d3-9a0c-0305e82c3301' as WaitlistFlowId;
const OTHER_FLOW = '9c858901-8a57-4791-81fe-4c455b099bc9' as WaitlistFlowId;
let HANDLE: string;

beforeAll(async () => {
	HANDLE = await mintWaitlistFlowId(SECRET, FLOW);

	await client.execute(
		`CREATE TABLE waitlist_funnel_event (
			flow_id text NOT NULL,
			event text NOT NULL,
			created_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
			PRIMARY KEY (flow_id, event)
		)`
	);
});

afterAll(() => client.close());

beforeEach(async () => {
	inflight.length = 0;
	await client.execute('DELETE FROM waitlist_funnel_event');
});

describe('the events table', () => {
	// The privacy rule is structural: the table has nowhere to put an IP, a user agent, an email or
	// an answer, so no future writer can start recording one without this failing. DAR-58 keeps the
	// free-text answers (deployment scale, the money questions) internal, and "internal" has to mean
	// they never reach an analytics row either.
	it('has no column that could hold personal data', () => {
		expect(Object.keys(getTableColumns(waitlistFunnelEvent)).sort()).toEqual([
			'createdAt',
			'event',
			'flowId'
		]);
	});
});

// DAR-86. The flow id used to travel as a bare UUID, so the composite primary key capped a flow the
// caller CHOSE — a fresh `crypto.randomUUID()` per POST defeated it outright, and the step endpoints
// and the public command reached the insert with no continuation token at all. Signing the transport
// makes /waitlist's load the only minter, so a row costs a page view.
describe('the signed flow id', () => {
	it('round-trips the bare id it carries', async () => {
		expect(await verifyWaitlistFlowId(SECRET, HANDLE)).toBe(FLOW);
	});

	// THE VECTOR THE TICKET IS ABOUT, at its smallest: what an attacker can produce unaided is a
	// well-formed UUID, and that is now worth nothing.
	it('rejects the bare id, which is all an attacker can mint', async () => {
		expect(await verifyWaitlistFlowId(SECRET, FLOW)).toBeNull();
	});

	it.each([
		['junk', 'not-a-handle'],
		['an empty string', ''],
		['a non-string', 42],
		['a missing value', undefined],
		// Longer than the echo will ever reflect, so it cannot be ours — rejected before the HMAC.
		['an over-long value', 'n1.' + 'x'.repeat(400)]
	])('rejects %s', async (_label, value) => {
		expect(await verifyWaitlistFlowId(SECRET, value)).toBeNull();
	});

	it('rejects a handle signed with a different secret', async () => {
		const foreign = await mintWaitlistFlowId(OTHER_SECRET, FLOW);
		expect(await verifyWaitlistFlowId(SECRET, foreign)).toBeNull();
	});

	// DAR-98. The handle deliberately OUTLIVES the continuation token, and this is the behavioural
	// statement of that — through both real code paths, not by comparing two constants. A day-old tab
	// is the case that used to break: the handle expired with the token, so the visitor's remaining
	// stages recorded nothing AND the null went into the resume cookie, after which every render minted
	// a fresh flow and wrote another `waitlist_viewed`. Numerator down, denominator up, for a day.
	//
	// Losing the WRITE at 24h is correct — that capability really did expire. Losing the visitor's
	// identity with it was not: measurement must not be gated on authorization (DAR-83 settled the same
	// point for a token that aged out mid-flow).
	it('still counts a day-old tab, though its continuation token is gone', async () => {
		const minted = Date.UTC(2026, 0, 1);
		const dayOld = minted + 25 * 3600_000;
		const handle = await mintWaitlistFlowId(SECRET, FLOW, minted);
		const token = await mintWaitlistToken(SECRET, 'a1b2c3d4-0000-4000-8000-00000000beef', minted);

		expect(await verifyWaitlistToken(SECRET, token, dayOld)).toBeNull();
		expect(await verifyWaitlistFlowId(SECRET, handle, dayOld)).toBe(FLOW);
	});

	// MONTHS, not "a bit more than the token". The test above passes at any TTL over ~25h, and the
	// boundary test below derives its clock FROM the constant, so both stay green if someone trims this
	// to 48h — which reinstates DAR-98 for a three-day tab. That is not hypothetical: before THIS test
	// existed, mutating the constant to 2 days passed all 47 of the others. So it is the one assertion
	// pinning the MAGNITUDE, and it does that as the claim the design actually makes — a tab left open
	// for months is still one visitor — rather than by restating the constant back to itself.
	it('counts a tab left open for months, which is the point of the number', async () => {
		const minted = Date.UTC(2026, 0, 1);
		const handle = await mintWaitlistFlowId(SECRET, FLOW, minted);
		const halfAYearOn = minted + 180 * 24 * 3600_000;

		expect(await verifyWaitlistFlowId(SECRET, handle, halfAYearOn)).toBe(FLOW);
		expect(WAITLIST_FLOW_ID_TTL_SECONDS).toBeGreaterThan(WAITLIST_TOKEN_TTL_SECONDS);
	});

	// Long, not unbounded — a value that cannot age out is a permanent bearer artifact, and "deliberately
	// long" has to stay distinguishable from "someone dropped the expiry". Boundary either side, so the
	// TTL a handle is minted with is the one it actually gets.
	it('does still expire, at its own window rather than the token’s', async () => {
		const minted = Date.UTC(2026, 0, 1);
		const handle = await mintWaitlistFlowId(SECRET, FLOW, minted);
		const justInside = minted + (WAITLIST_FLOW_ID_TTL_SECONDS - 1) * 1000;
		const atExpiry = minted + WAITLIST_FLOW_ID_TTL_SECONDS * 1000;

		expect(await verifyWaitlistFlowId(SECRET, handle, justInside)).toBe(FLOW);
		expect(await verifyWaitlistFlowId(SECRET, handle, atExpiry)).toBeNull();
	});

	// Domain separation, both directions. All four of the flow's signed values key off the same
	// BETTER_AUTH_SECRET, so nothing but the domain and prefix inside the MAC keeps a funnel handle
	// from being presented as a row-authorizing continuation token, or vice versa.
	it('is not interchangeable with a continuation token', async () => {
		const token = await mintWaitlistToken(SECRET, FLOW);

		expect(await verifyWaitlistFlowId(SECRET, token)).toBeNull();
		expect(await verifyWaitlistToken(SECRET, HANDLE)).toBeNull();
	});

	// The minter trusts its one caller (the load, which passes `newWaitlistFlowId()`); the verifier does
	// not. It is what keeps "this column holds fixed-width opaque ids" a property of the code rather
	// than of who happens to call the minter.
	it('rejects a validly signed handle whose payload is not a UUID', async () => {
		const wrong = await mintWaitlistFlowId(SECRET, 'not-a-uuid' as WaitlistFlowId);
		expect(await verifyWaitlistFlowId(SECRET, wrong)).toBeNull();
	});

	// Fresh ids are ids, and distinct ones. The one place a flow id is created without a signature to
	// earn it, so it is worth saying out loud what it produces.
	it('mints fresh ids of the column’s own shape', () => {
		const a = newWaitlistFlowId();
		expect(isWaitlistFlowId(a)).toBe(true);
		expect(a).not.toBe(newWaitlistFlowId());
	});
});

// The crossing every public entry point makes — the signup, the four steps, the confirmation's
// command. Its answers are all the same `null`, deliberately: nothing downstream could act on the
// distinction, and no visitor should see one.
describe('resolveWaitlistFlowId', () => {
	it('hands back the id a valid handle carries', async () => {
		expect(await resolveWaitlistFlowId(SECRET, HANDLE)).toBe(FLOW);
	});

	// Uniformly dark, never partially. A deploy missing BETTER_AUTH_SECRET cannot mint handles either,
	// so the alternative to this is `waitlist_viewed` climbing against zero conversions — a readout
	// that misleads worse than an absent one.
	it('is null without a signing secret, which takes the whole funnel dark together', async () => {
		expect(await resolveWaitlistFlowId(undefined, HANDLE)).toBeNull();
		expect(await resolveWaitlistFlowId('' as WaitlistSigningSecret, HANDLE)).toBeNull();
	});

	it.each([
		// THE VECTOR: a well-formed UUID is all an attacker can produce unaided, and it buys nothing.
		['a bare, unsigned flow id', FLOW],
		['junk', 'not-a-handle'],
		['an empty string', ''],
		['a missing value', undefined],
		['an object', { flowId: FLOW }]
	])('is null for %s', async (_label, value) => {
		expect(await resolveWaitlistFlowId(SECRET, value)).toBeNull();
	});

	// Analytics may fail, and a visitor must never find out — the same contract `resolveStepRow` keeps
	// for the continuation token beside it. A throwing crypto layer degrades to "not measured".
	//
	// `finally`, unlike the console spies elsewhere in this file: a `crypto.subtle.verify` left mocked
	// would break every signed value in every test after it, so one real failure here would come back
	// as a wall of unrelated red.
	it('never throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const verify = vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(new Error('no subtle'));

		try {
			await expect(resolveWaitlistFlowId(SECRET, HANDLE)).resolves.toBeNull();
			expect(error).toHaveBeenCalled();
		} finally {
			verify.mockRestore();
			error.mockRestore();
		}
	});
});

describe('captureWaitlistFunnel', () => {
	it('writes one row per event for the flow', async () => {
		captureWaitlistFunnel(db, platform, FLOW, ['waitlist_viewed', 'waitlist_signup_completed']);
		await flush();

		// Compared as a set: row order is the primary key's, not the call's, and nothing depends on it.
		expect(await rows()).toEqual(
			expect.arrayContaining([
				{ flowId: FLOW, event: 'waitlist_viewed' },
				{ flowId: FLOW, event: 'waitlist_signup_completed' }
			])
		);
		expect(await rows()).toHaveLength(2);
	});

	// THE CAP. A replayed submit, a double-click or a bot re-POSTing the same step adds nothing, so a
	// flow is bounded to one row per event and every count stays a count of distinct flows — which is
	// what makes signups/views a conversion rate rather than a ratio of retries.
	it('records an event at most once per flow, however many times it fires', async () => {
		for (let i = 0; i < 5; i++)
			captureWaitlistFunnel(db, platform, FLOW, ['qualification_started']);
		await flush();

		expect(await rows()).toEqual([{ flowId: FLOW, event: 'qualification_started' }]);
	});

	it('keeps flows independent', async () => {
		captureWaitlistFunnel(db, platform, FLOW, ['waitlist_viewed']);
		captureWaitlistFunnel(db, platform, OTHER_FLOW, ['waitlist_viewed']);
		await flush();

		expect(await rows()).toHaveLength(2);
	});

	// A duplicate inside ONE call would make the statement conflict with itself; SQLite would reject
	// the whole insert and the sibling event would be lost with it.
	it('de-dupes within a single call without dropping the other events', async () => {
		captureWaitlistFunnel(db, platform, FLOW, [
			'qualification_completed',
			'qualification_completed',
			'pilot_interest_selected'
		]);
		await flush();

		expect((await rows()).map((r) => r.event).sort()).toEqual([
			'pilot_interest_selected',
			'qualification_completed'
		]);
	});

	// FAIL-CLOSED UNDER A CAST. The brand makes skipping `resolveWaitlistFlowId` a compile error, but a
	// cast would get past it, so the shape check underneath has to be the thing that decides — and a
	// signed handle is not UUID-shaped, so the mistake records NOTHING rather than filling the column
	// with attacker-supplied text. `null` is the ordinary case: no secret, or a handle that didn't
	// verify.
	it.each([
		['a signed handle passed straight through', () => HANDLE],
		['a malformed id', () => 'not-a-uuid'],
		['an empty id', () => ''],
		['nothing at all', () => null]
	])('writes nothing for %s', async (_label, value) => {
		captureWaitlistFunnel(db, platform, value() as WaitlistFlowId | null, ['waitlist_viewed']);
		// A real id in the same drain is the vacuity guard: "no rows" is what a capture that had simply
		// stopped working would produce too, so the assertion has to be able to tell them apart.
		captureWaitlistFunnel(db, platform, OTHER_FLOW, ['waitlist_viewed']);
		await flush();

		expect(await rows()).toEqual([{ flowId: OTHER_FLOW, event: 'waitlist_viewed' }]);
	});

	// THE CAP KEYS ON THE FLOW, NOT THE HANDLE. Two distinct signed strings for one flow still collapse
	// to a single row, so re-signing is no way around the composite key — which is what makes "a page
	// load buys one row per event" the bound rather than "a MINT buys one".
	it('collapses two handles for the same flow into one row', async () => {
		const later = await mintWaitlistFlowId(SECRET, FLOW, Date.now() + 5000);
		expect(later).not.toBe(HANDLE);

		captureWaitlistFunnel(db, platform, await resolveWaitlistFlowId(SECRET, HANDLE), [
			'waitlist_viewed'
		]);
		captureWaitlistFunnel(db, platform, await resolveWaitlistFlowId(SECRET, later), [
			'waitlist_viewed'
		]);
		await flush();

		expect(await rows()).toEqual([{ flowId: FLOW, event: 'waitlist_viewed' }]);
	});

	it('writes nothing for an empty event list', async () => {
		captureWaitlistFunnel(db, platform, FLOW, []);
		await flush();

		expect(await rows()).toEqual([]);
	});

	// The type makes this unreachable from our own code; the guard exists for the public command,
	// where the slug came off the wire.
	it('drops an unknown slug that reached it anyway', async () => {
		captureWaitlistFunnel(db, platform, FLOW, [
			'waitlist_purchased' as unknown as WaitlistFunnelEvent,
			'waitlist_viewed'
		]);
		await flush();

		expect(await rows()).toEqual([{ flowId: FLOW, event: 'waitlist_viewed' }]);
	});

	it('does nothing without a database client', () => {
		expect(() =>
			captureWaitlistFunnel(undefined, platform, FLOW, ['waitlist_viewed'])
		).not.toThrow();
		expect(inflight).toHaveLength(0);
	});

	// The whole posture in one test: analytics may fail, and the caller must never find out. A
	// rejected insert is logged and swallowed — no throw, and no unhandled rejection escaping into a
	// request that was otherwise fine.
	it('swallows a failing write', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const brokenDb = {
			insert: () => ({
				values: () => ({ onConflictDoNothing: () => Promise.reject(new Error('no database')) })
			})
		} as unknown as Db;

		expect(() =>
			captureWaitlistFunnel(brokenDb, platform, FLOW, ['waitlist_viewed'])
		).not.toThrow();
		await expect(flush()).resolves.toBeDefined();
		expect(error).toHaveBeenCalled();

		error.mockRestore();
	});

	// Under `vite dev` there is no ExecutionContext. The write must still be issued (the process
	// outlives the response there), and the missing ctx must not throw.
	it('still writes when the platform has no execution context', async () => {
		captureWaitlistFunnel(db, undefined, FLOW, ['waitlist_viewed']);
		// Nothing to drain — give the floating insert a turn to settle.
		await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
	});
});

// DAR-83. Step 1's honeypot has always withheld `waitlist_signup_completed`; steps 2–4 didn't, so a
// bot that tripped the trap and drove the rest of the flow on its decoy token made the later stages
// exceed the signups they descend from. The gate makes the trap's effect uniform across the two
// surfaces it can reach: no submission row, no funnel row.
describe('captureWaitlistStepFunnel', () => {
	const ROW = '5b1f2c3d-9e8a-4b7c-8d6e-1f2a3b4c5d6e'; // a submission id, as verifyWaitlistToken returns

	it('records a step’s events for a real submission id', async () => {
		captureWaitlistStepFunnel(db, platform, ROW, FLOW, [
			'qualification_started',
			'use_case_completed'
		]);
		await flush();

		expect((await rows()).map((r) => r.event).sort()).toEqual([
			'qualification_started',
			'use_case_completed'
		]);
	});

	// Every stage, not a sampled one: passing the whole vocabulary means a slug added later is covered
	// here the day it exists. The real id in the same drain is the vacuity guard — a wrapper that
	// dropped everything would pass the decoy half on its own.
	it('records NOTHING for the honeypot’s decoy id, at any stage', async () => {
		const decoy = await decoyWaitlistId(SECRET, 'bot@example.com');

		captureWaitlistStepFunnel(db, platform, ROW, FLOW, WAITLIST_FUNNEL_EVENTS);
		captureWaitlistStepFunnel(db, platform, decoy, OTHER_FLOW, WAITLIST_FUNNEL_EVENTS);
		await flush();

		const written = await rows();
		expect(written).toHaveLength(WAITLIST_FUNNEL_EVENTS.length);
		expect(written.map((r) => r.flowId)).not.toContain(OTHER_FLOW);
	});

	// THE POLARITY IS DELIBERATE, and the opposite of the write's. An unusable token — expired,
	// absent, tampered, or a deploy with no signing secret — is not evidence of a bot: it covers the
	// visitor whose token aged out mid-flow, who genuinely reached this stage, and gating on it would
	// take the whole step funnel dark on a misconfigured deploy rather than merely stop enriching. The
	// decoy is the one id that carries a positive signal, because it exists only for someone who
	// filled a field no human can see.
	it('still records when the token was unusable, which is not the same as a decoy', async () => {
		captureWaitlistStepFunnel(db, platform, null, FLOW, ['qualification_started']);
		await flush();

		expect(await rows()).toEqual([{ flowId: FLOW, event: 'qualification_started' }]);
	});
});

// The gate is worth nothing unless the step endpoints actually go through it, and no type can force
// that: `captureWaitlistFunnel` stays exported for step 1 and the page load, so it remains importable
// from anywhere. The rule therefore lives in a spec that reads source — the same move
// `evidence-boundary.spec.ts` makes for a rule TypeScript can't hold.
//
// SCANNED ACROSS ALL OF `src`, not one path (DAR-102). This block read `waitlist-steps.remote.ts`
// and nothing else, which made DAR-83's stated purpose — "so a fifth step can't quietly
// under-report" — true only for a fifth step written into that same file. One added as
// `waitlist-step5.remote.ts` could import the ungated function, skip the honeypot gate, and pass
// every assertion here, because none of them ever looked at it.
//
// The set is `src`, not the waitlist's own directories, and that is the second thing measurement
// changed: scoping it to those directories reproduced the very defect one level down — a step planted
// at `src/routes/waitlist/step5/+page.server.ts` passed 56/56, and one under `src/routes/api/` would
// not have been looked at either. "Who imports the ungated capture function?" has no reason to stop
// at a directory boundary, and nothing outside the waitlist imports it, so the wider set costs
// nothing. (DAR-99's secret rule keeps the narrower one — `auth.ts` names that key legitimately.)
//
// THE RULE IS AN ALLOWLIST, and that is the part worth reading twice. The obvious tightening — nobody
// may import `captureWaitlistFunnel` — is simply false: three surfaces use it legitimately, and each
// has a reason recorded below. But naming those three and derived-scanning everything else is not the
// blanket ban; it is a rule that fails CLOSED for any new file, however that file came by its row id.
// A classifier ("files that verify a continuation token must gate") was the alternative and is weaker:
// extract `resolveStepRow` into a shared helper and the new step endpoint imports `verifyWaitlistToken`
// nowhere, so the classifier stops seeing it while the allowlist still does.
//
// A hand-written ALLOWLIST is fine where a hand-written SCAN list is not (DAR-99), and the difference
// is polarity: deleting an entry from a scan list makes the scan blind — silent. Deleting one here
// makes the rule stricter, so that file starts failing. Both directions of edit report themselves.
describe('the step endpoints reach the funnel only through the gate', () => {
	const FUNNEL_MODULE = '$lib/server/waitlist-funnel';

	/**
	 * The three surfaces that may reach the funnel WITHOUT the honeypot gate, and why each one can't
	 * use it. Adding a fourth is a deliberate, reviewable act — which is the point.
	 */
	// The `captures` count is what makes the exemption PER CALL SITE rather than per file, and that
	// distinction is load-bearing: a file-level pass would let a fifth step added INSIDE one of these
	// three inherit its exemption, which was measured — appending a step to `waitlist.remote.ts` that
	// used the ungated function passed everything here unless it happened to follow the
	// `submitWaitlistStep` naming convention. Each of these files makes exactly ONE ungated capture,
	// which is the one its reason describes; a second is a new call site and needs its own argument.
	const UNGATED = {
		// Step 1 MINTS the continuation token rather than verifying one, so there is no resolved row id
		// here to test for a decoy. It keeps bots out of the conversion metric a different way: the
		// honeypot path returns long before this capture (DAR-66).
		'src/lib/waitlist.remote.ts': {
			captures: 1,
			why: 'step 1 — mints the token, honeypot returns before the capture'
		},
		// The view event precedes the trap: a visitor has to see the form before they can fill the
		// invisible field. A resumed decoy keeps its flow id, so the re-record collides with its own
		// first GET under the composite key and costs nothing (DAR-83).
		'src/routes/waitlist/+page.server.ts': {
			captures: 1,
			why: 'the page load — the view precedes the trap'
		},
		// The one inversion DAR-83 left standing, deliberately: `evaluation_conversation_requested`
		// fires from the confirmation, and DAR-75 drops the row id at `done`, so this command cannot
		// know whether the flow behind it was a decoy.
		'src/lib/waitlist-funnel.remote.ts': {
			captures: 1,
			why: 'the client-fired command — no row id exists by then'
		}
	} as const;

	const allowed = Object.keys(UNGATED) as (keyof typeof UNGATED)[];

	// A derivation that matched nothing, or an allowlist naming files that no longer exist, would make
	// the assertions below vacuously true. Pin both against the derived surface — and include a file
	// OUTSIDE the waitlist's own directories, because "the scan reaches past src/routes/waitlist" is
	// the property DAR-102's second measurement bought and nothing else here would notice losing it.
	it('found the surface, and every allowlisted path is in it', () => {
		for (const required of [
			...allowed,
			'src/lib/waitlist-steps.remote.ts',
			'src/routes/admin/waitlist/+page.server.ts' // a nested route, and not under the waitlist tree
		]) {
			expect(appSourcePaths()).toContain(required);
		}
	});

	// THE RULE. Everything on the surface except the three either goes through the gate or doesn't
	// touch the funnel at all.
	it('lets only the allowlisted three import the ungated entry point', () => {
		const ungated = appSourcePaths().filter((path) =>
			importedNames(path, FUNNEL_MODULE).includes('captureWaitlistFunnel')
		);

		expect(ungated.sort()).toEqual([...allowed].sort());
	});

	// An allowlist entry that no longer imports the thing it excuses is dead weight, and dead weight is
	// how an allowlist rots into a list of files nobody checks. Same paired assertion
	// `safety-language.spec.ts` makes about its one allowlisted message key.
	it('keeps no allowlist entry that has stopped needing one', () => {
		for (const path of allowed) {
			expect(
				importedNames(path, FUNNEL_MODULE),
				`${path} is allowlisted as "${UNGATED[path].why}" but no longer imports the ungated ` +
					`entry point — drop the entry rather than leaving an exemption nothing uses`
			).toContain('captureWaitlistFunnel');
		}
	});

	// AND THE EXEMPTION IS PER CALL SITE. Without this, a step added inside one of the three inherits
	// the file's pass — measured: appending one to `waitlist.remote.ts` that used the ungated function
	// was invisible here unless it also happened to be named `submitWaitlistStep…`.
	it('holds each allowlisted file to the one ungated capture its reason covers', () => {
		for (const path of allowed) {
			const calls = sourceText(path).match(/captureWaitlistFunnel\(/g)?.length ?? 0;
			expect(
				calls,
				`${path} is exempt for exactly one ungated capture ("${UNGATED[path].why}") but makes ` +
					`${calls}. A second call site is a new decision: gate it, or give it its own reason here.`
			).toBe(UNGATED[path].captures);
		}
	});

	// A namespace import binds every export without naming one, so it would walk straight past the
	// assertion above. Banned surface-wide, including for the allowlisted three: they already import
	// what they need by name, so nothing legitimate wants this.
	//
	// A DYNAMIC import walks past it the same way and for a plainer reason — the scan parses the
	// static form only. Added by DAR-121, which hit it on its own sibling rule and then measured this
	// one: a step endpoint planted at `src/routes/waitlist/step5/` that reached the ungated capture
	// through `await import(…)` and skipped the honeypot gate passed here **52/52**. Same ban, same
	// argument: the three that may capture ungated already import by name.
	it('reaches the funnel module by name everywhere, never sideways', () => {
		for (const path of appSourcePaths()) {
			expect(
				importsNamespace(path, FUNNEL_MODULE) || importsDynamically(path, FUNNEL_MODULE),
				`${path} reaches the funnel module through a namespace or dynamic import`
			).toBe(false);
		}
	});

	// A step that fires no funnel event at all is not a thing the flow has (every step reports at
	// least that it was reached), so "one call per step form" is the shape a new step has to keep. It
	// fails loudly rather than silently under-reporting the middle of the funnel.
	//
	// This half recognizes the naming convention, so a step exported under some other name slips it —
	// the rule above is the one that doesn't depend on how anything is spelled.
	it('calls the gated one at least once per step form', () => {
		let forms = 0;

		for (const path of appSourcePaths()) {
			const source = sourceText(path);
			const declared = source.match(/export const submitWaitlistStep/g)?.length ?? 0;
			if (declared === 0) continue;

			const calls = source.match(/captureWaitlistStepFunnel\(/g)?.length ?? 0;
			expect(
				calls,
				`${path} declares ${declared} step form(s) but makes ${calls} gated capture(s)`
			).toBeGreaterThanOrEqual(declared);
			forms += declared;
		}

		expect(forms).toBeGreaterThanOrEqual(4); // steps 2, 3, 4A, 4B — the flow is intact
	});
});

describe('readWaitlistFunnelCounts', () => {
	it('zero-fills every stage nobody has reached', async () => {
		const counts = await readWaitlistFunnelCounts(db);

		expect(Object.keys(counts).sort()).toEqual([...WAITLIST_FUNNEL_EVENTS].sort());
		expect(Object.values(counts).every((n) => n === 0)).toBe(true);
	});

	it('counts distinct flows per stage', async () => {
		captureWaitlistFunnel(db, platform, FLOW, ['waitlist_viewed', 'waitlist_signup_completed']);
		captureWaitlistFunnel(db, platform, OTHER_FLOW, ['waitlist_viewed']);
		await flush();

		const counts = await readWaitlistFunnelCounts(db);
		expect(counts.waitlist_viewed).toBe(2);
		expect(counts.waitlist_signup_completed).toBe(1);
		expect(counts.qualification_started).toBe(0);
	});

	// A slug retired from the vocabulary should leave the readout with it — it has no label, and a
	// row from an older deploy shouldn't resurrect a stage the funnel no longer has.
	it('ignores stored rows whose slug is no longer known', async () => {
		await client.execute(
			"INSERT INTO waitlist_funnel_event (flow_id, event) VALUES ('" + FLOW + "', 'retired_event')"
		);

		const counts = await readWaitlistFunnelCounts(db);
		expect(Object.keys(counts)).not.toContain('retired_event');
		expect(Object.values(counts).every((n) => n === 0)).toBe(true);
	});
});

describe('signupConversionRate', () => {
	const counts = (over: Partial<WaitlistFunnelCounts> = {}): WaitlistFunnelCounts => ({
		...(Object.fromEntries(
			WAITLIST_FUNNEL_EVENTS.map((event) => [event, 0])
		) as WaitlistFunnelCounts),
		...over
	});

	it('is the signups over the views', () => {
		expect(
			signupConversionRate(counts({ waitlist_viewed: 200, waitlist_signup_completed: 50 }))
		).toBe(0.25);
	});

	// Null, not zero: with no denominator there is no rate, and "0%" would read as "nobody converts"
	// rather than "nothing measured yet".
	it('is null before anything has been viewed', () => {
		expect(signupConversionRate(counts({ waitlist_signup_completed: 3 }))).toBeNull();
	});

	// Deliberately unclamped. Above 100% means signups arrived without a matching view — a bot
	// posting straight to the endpoint, or a lost view write — and capping it would hide exactly the
	// anomaly worth seeing on an internal readout.
	it('does not hide a ratio above one', () => {
		expect(signupConversionRate(counts({ waitlist_viewed: 1, waitlist_signup_completed: 4 }))).toBe(
			4
		);
	});
});
