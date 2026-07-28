import { describe, expect, it } from 'vitest';
import {
	mintWaitlistResume,
	verifyWaitlistResume,
	WAITLIST_RESUME_STAGES,
	WAITLIST_RESUME_TTL_SECONDS,
	type WaitlistResumeState
} from './waitlist-resume';
import { mintSignedValue, mintWaitlistToken, verifyWaitlistToken } from './waitlist-token';
import { mintWaitlistFlowClaim } from './waitlist-flow';
import type { WaitlistFlowId } from '$lib/waitlist-funnel';

// The resume value (DAR-75) is what a RELOAD of /waitlist is rebuilt from, so everything the page
// then renders — which step, which CTA, which row the re-minted continuation token addresses — comes
// out of here. Two properties carry the weight: nothing the browser can edit changes any of it, and
// anything that isn't exactly what we wrote comes back as a plain `null` (which renders the blank
// step-1 form, i.e. the behaviour this feature replaced — the safe answer).

const SECRET = 'test-secret-not-a-real-one';
const NOW = 1_800_000_000_000; // fixed ms clock — determinism, no Date.now() flake
const ROW = '01890a5c-1111-4222-8333-444455556666';
// The BARE flow id, which is what the cookie carries — never the signed handle the hidden fields hold
// (DAR-86): the signing core splits on '.', so a signed value can't be a field inside another one.
const FLOW = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as WaitlistFlowId;

const state = (overrides: Partial<WaitlistResumeState> = {}): WaitlistResumeState => ({
	stage: 'step3',
	submissionId: ROW,
	branch: 'step4a',
	audience: 'commercial',
	cta: null,
	flowId: FLOW,
	...overrides
});

describe('mintWaitlistResume / verifyWaitlistResume', () => {
	it('roundtrips every field, and carries the r1 prefix that keeps it apart from the other two signed values', async () => {
		const value = await mintWaitlistResume(SECRET, state(), NOW);
		expect(value.startsWith('r1.')).toBe(true);
		await expect(verifyWaitlistResume(SECRET, value, NOW)).resolves.toEqual(state());
	});

	it('roundtrips every resumable stage', async () => {
		for (const stage of WAITLIST_RESUME_STAGES) {
			const value = await mintWaitlistResume(SECRET, state({ stage }), NOW);
			await expect(verifyWaitlistResume(SECRET, value, NOW)).resolves.toMatchObject({ stage });
		}
	});

	// The `done` shape, spelled out: no row id (nothing left to write), no branch/audience, a CTA.
	// This is the one state a finished visitor's browser keeps, and it must be inert.
	it('roundtrips a terminal state that carries a CTA and no row id', async () => {
		const done = state({
			stage: 'done',
			submissionId: null,
			branch: null,
			audience: null,
			cta: 'pilot'
		});
		const value = await mintWaitlistResume(SECRET, done, NOW);
		await expect(verifyWaitlistResume(SECRET, value, NOW)).resolves.toEqual(done);
	});

	it('stays valid just inside the TTL and dies at/after expiry', async () => {
		const value = await mintWaitlistResume(SECRET, state(), NOW);
		const justInside = NOW + (WAITLIST_RESUME_TTL_SECONDS - 1) * 1000;
		const atExpiry = NOW + WAITLIST_RESUME_TTL_SECONDS * 1000;
		await expect(verifyWaitlistResume(SECRET, value, justInside)).resolves.toEqual(state());
		await expect(verifyWaitlistResume(SECRET, value, atExpiry)).resolves.toBeNull();
	});

	it('rejects a value minted with a different secret, and absent/non-string input', async () => {
		const foreign = await mintWaitlistResume('some-other-secret', state(), NOW);
		await expect(verifyWaitlistResume(SECRET, foreign, NOW)).resolves.toBeNull();
		await expect(verifyWaitlistResume(SECRET, undefined, NOW)).resolves.toBeNull();
		await expect(verifyWaitlistResume(SECRET, '', NOW)).resolves.toBeNull();
		await expect(verifyWaitlistResume(SECRET, 42, NOW)).resolves.toBeNull();
	});

	it('rejects a tampered payload — the browser cannot promote itself to another step', async () => {
		const value = await mintWaitlistResume(SECRET, state({ stage: 'step2' }), NOW);
		const [prefix, payload, exp, mac] = value.split('.');
		const promoted = payload.replace('step2', 'step4a');
		expect(promoted).not.toBe(payload); // the edit actually landed
		await expect(
			verifyWaitlistResume(SECRET, `${prefix}.${promoted}.${exp}.${mac}`, NOW)
		).resolves.toBeNull();
	});

	it('rejects an extended expiry and a flipped MAC', async () => {
		const value = await mintWaitlistResume(SECRET, state(), NOW);
		const [prefix, payload, exp, mac] = value.split('.');
		await expect(
			verifyWaitlistResume(SECRET, `${prefix}.${payload}.${Number(exp) + 3600}.${mac}`, NOW)
		).resolves.toBeNull();
		const flipped = value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
		await expect(verifyWaitlistResume(SECRET, flipped, NOW)).resolves.toBeNull();
	});

	// DOMAIN SEPARATION. All three signed values key off BETTER_AUTH_SECRET, so the only thing keeping
	// them from being interchangeable is the domain string (and the prefix). A continuation token
	// presented as resume state would be a stage chosen by whoever held a token; a resume value
	// presented as a token would be a write authorization minted from a cookie the flow treats as
	// UX state.
	it('cannot be forged from — or used as — a continuation token or a flow claim', async () => {
		const token = await mintWaitlistToken(SECRET, ROW, NOW);
		const claim = await mintWaitlistFlowClaim(
			SECRET,
			{ branch: 'step4a', audience: 'commercial' },
			NOW
		);
		await expect(verifyWaitlistResume(SECRET, token, NOW)).resolves.toBeNull();
		await expect(verifyWaitlistResume(SECRET, claim, NOW)).resolves.toBeNull();

		// …and the reverse: a resume value is not a write authorization.
		const resume = await mintWaitlistResume(SECRET, state(), NOW);
		await expect(verifyWaitlistToken(SECRET, resume, NOW)).resolves.toBeNull();
	});

	it('refuses an over-long value before spending an HMAC on it', async () => {
		await expect(
			verifyWaitlistResume(SECRET, `r1.${'x'.repeat(600)}.1.aa`, NOW)
		).resolves.toBeNull();
	});
});

// FAILS CLOSED on anything outside a field's vocabulary. Every component can only have come from us,
// so an unknown one means the value isn't ours to trust — and the honest response is the blank form,
// not a half-populated resume. These are re-signed with the real secret precisely so the MAC ISN'T
// what rejects them: it is the narrowing that has to.
describe('verifyWaitlistResume vocabulary narrowing', () => {
	const resign = (payload: string) =>
		mintSignedValue(
			SECRET,
			'darcstar:waitlist-resume:v1',
			'r1',
			payload,
			WAITLIST_RESUME_TTL_SECONDS,
			NOW
		);

	it('rejects an unknown stage even when the signature is genuine', async () => {
		await expect(
			verifyWaitlistResume(SECRET, await resign(`step9|${ROW}||||${FLOW}`), NOW)
		).resolves.toBeNull();
		// `step1` specifically: it is the ABSENCE of resume state, never a stored one.
		await expect(
			verifyWaitlistResume(SECRET, await resign(`step1|${ROW}||||${FLOW}`), NOW)
		).resolves.toBeNull();
	});

	it('rejects an unknown branch, audience or CTA', async () => {
		for (const payload of [
			`step3|${ROW}|step9|commercial||${FLOW}`,
			`step3|${ROW}|step4a|tycoon||${FLOW}`,
			`done||||moon|${FLOW}`
		]) {
			await expect(verifyWaitlistResume(SECRET, await resign(payload), NOW)).resolves.toBeNull();
		}
	});

	it('rejects a payload with the wrong number of fields', async () => {
		await expect(verifyWaitlistResume(SECRET, await resign('step2'), NOW)).resolves.toBeNull();
		await expect(
			verifyWaitlistResume(SECRET, await resign(`step2|${ROW}||||${FLOW}|extra`), NOW)
		).resolves.toBeNull();
	});

	// The flow id is shape-checked on the way OUT because the load SIGNS it into the handle it hands
	// the page (DAR-86), and only ids of the column's own shape should ever be signed. A junk one
	// degrades to '' — the load then starts a fresh flow — rather than taking the whole resume down
	// with it, which is the one field where that trade is right: a lost handle costs a split funnel,
	// a lost resume costs the visitor their place in the form.
	it('drops a malformed flow id without discarding the rest of the state', async () => {
		await expect(
			verifyWaitlistResume(SECRET, await resign(`step2|${ROW}||||not-a-uuid`), NOW)
		).resolves.toEqual({
			stage: 'step2',
			submissionId: ROW,
			branch: null,
			audience: null,
			cta: null,
			flowId: null
		});
	});

	// A decoy id (the honeypot's) has to survive the round trip: the trap's responses have to look
	// exactly like a real signup's, cookie included, and the flow it resumes into no-ops every write.
	it('carries a decoy row id through unchanged', async () => {
		const decoy = 'decoy_AbC-dEf_GhIjKlMnOpQrSt';
		const value = await mintWaitlistResume(SECRET, state({ submissionId: decoy }), NOW);
		await expect(verifyWaitlistResume(SECRET, value, NOW)).resolves.toMatchObject({
			submissionId: decoy
		});
	});
});
