// Waitlist continuation token (DAR-59) — the authorization for the v2 flow's optional steps.
//
// Steps 2–4 are UNAUTHENTICATED writes that enrich the row step 1 created. The step-1 response
// therefore carries a signed, expiring token; each later step submits it back and the server
// verifies before updating. Properties the flow depends on:
//
//   - A raw row id is never accepted — only `v1.<id>.<exp>.<mac>` with a valid HMAC, so knowing
//     (or guessing) an id grants nothing.
//   - Verification failure is a generic null — callers respond identically for "bad token" and
//     "row gone", so the token layer can't become a row/email-enumeration oracle.
//   - The MAC covers id AND expiry, so neither can be swapped or extended.
//
// The module also hosts the SIGNING CORE both of the flow's signed values are built on
// (`mintSignedValue`/`verifySignedValue`) — see the section above them.
//
// Pure module: callers resolve the secret (BETTER_AUTH_SECRET via platform.env/readEnv) and pass
// it in — same contract as the email builders — which keeps this unit-testable without a request.
// The secret is reused from Better Auth rather than provisioning a new one; the DOMAIN prefix
// inside the signed message domain-separates these MACs from anything Better Auth signs.
// Web Crypto (crypto.subtle) is available on workerd and in the Node test runner.

/** Steps are a same-sitting affair; a day of validity is generous without leaving tokens live. */
import type { WaitlistSigningSecret } from './waitlist-secret';

export const WAITLIST_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const DOMAIN = 'darcstar:waitlist-continuation:v1';
const PREFIX = 'v1';
const encoder = new TextEncoder();

async function hmacKey(
	secret: WaitlistSigningSecret,
	usage: 'sign' | 'verify'
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[usage]
	);
}

// The <ArrayBuffer> returns satisfy BufferSource under the workers-types lib, whose typed-array
// generics default to ArrayBufferLike (which includes SharedArrayBuffer and thus fails to narrow).
const message = (domain: string, payload: string, exp: number): Uint8Array<ArrayBuffer> =>
	encoder.encode(`${domain}:${payload}:${exp}`) as Uint8Array<ArrayBuffer>;

const b64url = (bytes: ArrayBuffer): string =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
	try {
		const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
		return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------------------------
// The signing core. BOTH of the flow's signed values share this shape — `<prefix>.<payload>.<exp>.
// <mac>` — and, more importantly, one implementation of the canonicalization rules below: the
// continuation token here, and the flow claim (waitlist-flow.ts, which owns routing
// and therefore its own tamper-proof transport). `domain` + `prefix` keep them apart — a value
// minted as one can never verify as the other, even though both key off BETTER_AUTH_SECRET.

/**
 * Mint `<prefix>.<payload>.<exp>.<mac>`. The payload must contain no '.' (verification splits on
 * it) — callers pass row UUIDs or fixed slugs. `now` is unix ms (injectable for tests).
 */
export async function mintSignedValue(
	secret: WaitlistSigningSecret,
	domain: string,
	prefix: string,
	payload: string,
	ttlSeconds: number,
	now: number = Date.now()
): Promise<string> {
	const exp = Math.floor(now / 1000) + ttlSeconds;
	const key = await hmacKey(secret, 'sign');
	const mac = await crypto.subtle.sign('HMAC', key, message(domain, payload, exp));
	return `${prefix}.${payload}.${exp}.${b64url(mac)}`;
}

/**
 * Verify a signed value → its payload, or null for ANY failure (malformed, expired, tampered, wrong
 * secret, wrong domain/prefix). crypto.subtle.verify is constant-time, and payload+exp being inside
 * the MAC means neither can be swapped or extended.
 *
 * Values are also canonicalized so ONE (payload, exp) has exactly ONE valid string: exp must be a
 * canonical decimal (no leading zeros), and the decoded MAC must re-encode to the exact bytes
 * received (base64url's unused trailing bits are otherwise malleable). Without this, distinct
 * strings verify to the same authorization — harmless for the write itself, but it would silently
 * break any future exact-string dedup / blocklist / replay-cache keyed on the value.
 */
export async function verifySignedValue(
	secret: WaitlistSigningSecret,
	domain: string,
	prefix: string,
	value: unknown,
	now: number = Date.now()
): Promise<string | null> {
	if (typeof value !== 'string') return null;
	const parts = value.split('.');
	if (parts.length !== 4 || parts[0] !== prefix) return null;
	const [, payload, expStr, macStr] = parts;
	if (payload.length === 0 || !/^(0|[1-9]\d*)$/.test(expStr)) return null;
	const exp = Number(expStr);
	if (!Number.isSafeInteger(exp) || Math.floor(now / 1000) >= exp) return null;
	const mac = b64urlDecode(macStr);
	// Reject non-canonical encodings: the decoded bytes must round-trip to the exact string received.
	if (mac === null || b64url(mac.buffer) !== macStr) return null;
	const key = await hmacKey(secret, 'verify');
	const ok = await crypto.subtle.verify('HMAC', key, mac, message(domain, payload, exp));
	return ok ? payload : null;
}

/** Mint `v1.<rowId>.<exp>.<mac>` for a waitlist row. `now` is unix ms (injectable for tests). */
export function mintWaitlistToken(
	secret: WaitlistSigningSecret,
	rowId: string,
	now: number = Date.now()
): Promise<string> {
	return mintSignedValue(secret, DOMAIN, PREFIX, rowId, WAITLIST_TOKEN_TTL_SECONDS, now);
}

/**
 * The DECOY row id for the honeypot path — an id that addresses no real row, so any step write it
 * authorizes silently no-ops.
 *
 * DETERMINISTIC in the email so repeat honeypot submits return the same id; a fresh-random id each
 * time would itself fingerprint the trap. Exported because the honeypot path has to look identical in
 * every observable way, which since DAR-75 includes the resume cookie it sets — that cookie stores an
 * id, not a token, so the decoy needs its id in hand and not just a token wrapped around it.
 */
export async function decoyWaitlistId(
	secret: WaitlistSigningSecret,
	email: string
): Promise<string> {
	const key = await hmacKey(secret, 'sign');
	const digest = await crypto.subtle.sign(
		'HMAC',
		key,
		encoder.encode(`decoy:${email}`) as Uint8Array<ArrayBuffer>
	);
	return `${DECOY_ID_PREFIX}${b64url(digest).slice(0, 22)}`;
}

/**
 * A DECOY continuation token for the honeypot path. It verifies structurally but its embedded id
 * addresses no real row (see `decoyWaitlistId`). This only makes the response BODY look like a real
 * success; the honeypot still returns before a real submit's DB round-trips, so a timing
 * side-channel remains (accepted — the goal is only that the JSON a bot parses looks identical).
 */
export async function mintDecoyWaitlistToken(
	secret: WaitlistSigningSecret,
	email: string,
	now: number = Date.now()
): Promise<string> {
	return mintWaitlistToken(secret, await decoyWaitlistId(secret, email), now);
}

const DECOY_ID_PREFIX = 'decoy_';

/**
 * Is this a verified id we minted for the honeypot? Kept here so the decoy's shape has ONE home.
 *
 * A step endpoint uses it to skip the write entirely: the row id is known-fake, so the UPDATE could
 * only ever match zero rows, and trap-tripping bots shouldn't get to spend DB writes. Safe to trust —
 * only `verifyWaitlistToken` output reaches this, and an id can't be chosen without forging the MAC.
 * It changes nothing observable: the response body is generic either way, and step 1's honeypot path
 * is already timing-distinguishable (accepted, documented).
 */
export const isDecoyWaitlistId = (id: string): boolean => id.startsWith(DECOY_ID_PREFIX);

/**
 * Verify a continuation token → the row id it authorizes, or null for ANY failure (malformed,
 * expired, tampered, wrong secret, or a value signed for a different purpose). The id/exp being
 * inside the MAC means a valid token for row A can never authorize row B; see `verifySignedValue`
 * for the constant-time + canonicalization guarantees this inherits.
 */
export function verifyWaitlistToken(
	secret: WaitlistSigningSecret,
	token: unknown,
	now: number = Date.now()
): Promise<string | null> {
	return verifySignedValue(secret, DOMAIN, PREFIX, token, now);
}
