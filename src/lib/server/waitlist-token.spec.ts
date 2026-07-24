import { describe, expect, it } from 'vitest';
import {
	mintWaitlistToken,
	verifyWaitlistToken,
	WAITLIST_TOKEN_TTL_SECONDS
} from './waitlist-token';

// The continuation token is the ONLY authorization for the flow's unauthenticated step writes
// (DAR-59), so every acceptance property is pinned here: roundtrip, expiry, and — critically —
// that no tampered variant (id, exp, mac, shape) ever verifies.

const SECRET = 'test-secret-not-a-real-one';
const ID = '01890a5c-1111-4222-8333-444455556666';
const NOW = 1_800_000_000_000; // fixed ms clock — determinism, no Date.now() flake

describe('mintWaitlistToken / verifyWaitlistToken', () => {
	it('roundtrips: a minted token verifies back to exactly the row id it was minted for', async () => {
		const token = await mintWaitlistToken(SECRET, ID, NOW);
		expect(token.startsWith(`v1.${ID}.`)).toBe(true);
		await expect(verifyWaitlistToken(SECRET, token, NOW)).resolves.toBe(ID);
	});

	it('stays valid just inside the TTL and dies at/after expiry', async () => {
		const token = await mintWaitlistToken(SECRET, ID, NOW);
		const justInside = NOW + (WAITLIST_TOKEN_TTL_SECONDS - 1) * 1000;
		const atExpiry = NOW + WAITLIST_TOKEN_TTL_SECONDS * 1000;
		await expect(verifyWaitlistToken(SECRET, token, justInside)).resolves.toBe(ID);
		await expect(verifyWaitlistToken(SECRET, token, atExpiry)).resolves.toBeNull();
		await expect(verifyWaitlistToken(SECRET, token, atExpiry + 60_000)).resolves.toBeNull();
	});

	it('rejects a swapped row id (the MAC binds the id — a token for row A never authorizes row B)', async () => {
		const token = await mintWaitlistToken(SECRET, ID, NOW);
		const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
		const [v1, , exp, mac] = token.split('.');
		await expect(
			verifyWaitlistToken(SECRET, `${v1}.${otherId}.${exp}.${mac}`, NOW)
		).resolves.toBeNull();
	});

	it('rejects an extended expiry (the MAC binds exp too)', async () => {
		const token = await mintWaitlistToken(SECRET, ID, NOW);
		const [v1, id, exp, mac] = token.split('.');
		const later = String(Number(exp) + 3600);
		await expect(
			verifyWaitlistToken(SECRET, `${v1}.${id}.${later}.${mac}`, NOW)
		).resolves.toBeNull();
	});

	it('rejects a tampered or truncated MAC', async () => {
		const token = await mintWaitlistToken(SECRET, ID, NOW);
		const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
		await expect(verifyWaitlistToken(SECRET, flipped, NOW)).resolves.toBeNull();
		await expect(verifyWaitlistToken(SECRET, token.slice(0, -4), NOW)).resolves.toBeNull();
	});

	it('rejects a token minted with a different secret', async () => {
		const token = await mintWaitlistToken('some-other-secret', ID, NOW);
		await expect(verifyWaitlistToken(SECRET, token, NOW)).resolves.toBeNull();
	});

	it('rejects malformed shapes without throwing (generic null — no oracle)', async () => {
		for (const junk of [
			null,
			undefined,
			42,
			'',
			ID, // a raw row id is never accepted
			'v1',
			`v2.${ID}.9999999999.AAAA`, // unknown version
			`v1.${ID}.not-a-number.AAAA`,
			`v1..9999999999.AAAA`, // empty id
			`v1.${ID}.9999999999.@@@@`, // invalid base64url
			`v1.${ID}.9999999999` // missing MAC segment
		]) {
			await expect(verifyWaitlistToken(SECRET, junk, NOW)).resolves.toBeNull();
		}
	});
});
