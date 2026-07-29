import { describe, expect, it } from 'vitest';
import {
	WAITLIST_UPDATES_CONFIRM_TTL_SECONDS,
	WAITLIST_UPDATES_UNSUBSCRIBE_TTL_SECONDS,
	mintUpdatesConfirmToken,
	mintUpdatesUnsubscribeToken,
	verifyUpdatesConfirmToken,
	verifyUpdatesUnsubscribeToken
} from './waitlist-updates-token';
import { mintWaitlistToken } from './waitlist-token';
import type { WaitlistSigningSecret } from './waitlist-secret';

// DAR-139's two emailed links. The shared signing core is already pinned by waitlist-token.spec.ts, so
// what is tested HERE is what is specific to these two: that they are separate capabilities with
// separate lifetimes, and that neither can be presented as the other.

// Branded because DAR-99 makes every mint and verify take the one resolver's output; a fixture has no
// request to read one from, so the cast states that honestly — waitlist-token.spec.ts's pattern.
const SECRET = 'test-secret-not-a-real-one' as WaitlistSigningSecret;
const OTHER_SECRET = 'a-different-deployments-secret' as WaitlistSigningSecret;
const LEAD = '01890a5c-1111-4222-8333-444455556666';
const NOW = 1_800_000_000_000; // fixed ms clock — determinism, no Date.now() flake

describe('the updates confirmation link', () => {
	it('roundtrips to exactly the lead it was minted for', async () => {
		const token = await mintUpdatesConfirmToken(SECRET, LEAD, NOW);
		expect(token.startsWith(`c1.${LEAD}.`)).toBe(true);
		await expect(verifyUpdatesConfirmToken(SECRET, token, NOW)).resolves.toBe(LEAD);
	});

	it('stays valid just inside the TTL and dies at expiry', async () => {
		const token = await mintUpdatesConfirmToken(SECRET, LEAD, NOW);
		const inside = NOW + (WAITLIST_UPDATES_CONFIRM_TTL_SECONDS - 1) * 1000;
		await expect(verifyUpdatesConfirmToken(SECRET, token, inside)).resolves.toBe(LEAD);
		const atExpiry = NOW + WAITLIST_UPDATES_CONFIRM_TTL_SECONDS * 1000;
		await expect(verifyUpdatesConfirmToken(SECRET, token, atExpiry)).resolves.toBeNull();
	});

	it('refuses another deployment’s secret', async () => {
		const token = await mintUpdatesConfirmToken(OTHER_SECRET, LEAD, NOW);
		await expect(verifyUpdatesConfirmToken(SECRET, token, NOW)).resolves.toBeNull();
	});

	it.each([
		['empty', ''],
		['not a token', 'nonsense'],
		['a bare lead id', LEAD],
		['a non-string', 42]
	])('refuses %s', async (_why, value) => {
		await expect(verifyUpdatesConfirmToken(SECRET, value, NOW)).resolves.toBeNull();
	});
});

describe('the updates unsubscribe link', () => {
	it('roundtrips to exactly the lead it was minted for', async () => {
		const token = await mintUpdatesUnsubscribeToken(SECRET, LEAD, NOW);
		expect(token.startsWith(`u1.${LEAD}.`)).toBe(true);
		await expect(verifyUpdatesUnsubscribeToken(SECRET, token, NOW)).resolves.toBe(LEAD);
	});

	it('stays valid just inside the TTL and dies at expiry', async () => {
		const token = await mintUpdatesUnsubscribeToken(SECRET, LEAD, NOW);
		const inside = NOW + (WAITLIST_UPDATES_UNSUBSCRIBE_TTL_SECONDS - 1) * 1000;
		await expect(verifyUpdatesUnsubscribeToken(SECRET, token, inside)).resolves.toBe(LEAD);
		const atExpiry = NOW + WAITLIST_UPDATES_UNSUBSCRIBE_TTL_SECONDS * 1000;
		await expect(verifyUpdatesUnsubscribeToken(SECRET, token, atExpiry)).resolves.toBeNull();
	});

	it('refuses another deployment’s secret', async () => {
		const token = await mintUpdatesUnsubscribeToken(OTHER_SECRET, LEAD, NOW);
		await expect(verifyUpdatesUnsubscribeToken(SECRET, token, NOW)).resolves.toBeNull();
	});
});

describe('the two links are separate capabilities', () => {
	// The reason they are two values rather than one with a mode. Presenting either at the other's route
	// must fail — otherwise a scanner following the "don't ask again" link could confirm, or a
	// confirmation could withdraw, and the domain separation would exist in the constants and nowhere
	// else.
	it('neither verifies as the other', async () => {
		const confirm = await mintUpdatesConfirmToken(SECRET, LEAD, NOW);
		const unsubscribe = await mintUpdatesUnsubscribeToken(SECRET, LEAD, NOW);
		await expect(verifyUpdatesUnsubscribeToken(SECRET, confirm, NOW)).resolves.toBeNull();
		await expect(verifyUpdatesConfirmToken(SECRET, unsubscribe, NOW)).resolves.toBeNull();
	});

	// …and neither is reachable from the flow's own values. A continuation token addresses a SUBMISSION
	// and is handed to whoever submitted the form; if it verified here, filling the form in would be
	// enough to confirm consent for the address you typed, which is the entire thing this gate exists to
	// stop.
	it('a continuation token confirms nothing', async () => {
		const continuation = await mintWaitlistToken(SECRET, LEAD, NOW);
		await expect(verifyUpdatesConfirmToken(SECRET, continuation, NOW)).resolves.toBeNull();
		await expect(verifyUpdatesUnsubscribeToken(SECRET, continuation, NOW)).resolves.toBeNull();
	});

	// The asymmetry is the design (a grant goes stale, a removal must not), and it is asserted as the
	// CLAIM the design makes — a withdrawal still works after a confirmation link has died — rather than
	// as the two constants compared to each other. DAR-98 measured why: a comparison self-adjusts under a
	// mutation to either number, and passes against a build that reinstates the very bug.
	it('an unsubscribe link still works long after a confirmation link has expired', async () => {
		const confirm = await mintUpdatesConfirmToken(SECRET, LEAD, NOW);
		const unsubscribe = await mintUpdatesUnsubscribeToken(SECRET, LEAD, NOW);
		const monthsLater = NOW + 120 * 24 * 60 * 60 * 1000;
		await expect(verifyUpdatesConfirmToken(SECRET, confirm, monthsLater)).resolves.toBeNull();
		await expect(verifyUpdatesUnsubscribeToken(SECRET, unsubscribe, monthsLater)).resolves.toBe(
			LEAD
		);
	});
});
