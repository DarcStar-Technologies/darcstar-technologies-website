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
// Pure module: callers resolve the secret (BETTER_AUTH_SECRET via platform.env/readEnv) and pass
// it in — same contract as the email builders — which keeps this unit-testable without a request.
// The secret is reused from Better Auth rather than provisioning a new one; the DOMAIN prefix
// inside the signed message domain-separates these MACs from anything Better Auth signs.
// Web Crypto (crypto.subtle) is available on workerd and in the Node test runner.

/** Steps are a same-sitting affair; a day of validity is generous without leaving tokens live. */
export const WAITLIST_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const DOMAIN = 'darcstar:waitlist-continuation:v1';
const encoder = new TextEncoder();

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
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
const message = (id: string, exp: number): Uint8Array<ArrayBuffer> =>
	encoder.encode(`${DOMAIN}:${id}:${exp}`) as Uint8Array<ArrayBuffer>;

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

/** Mint `v1.<rowId>.<exp>.<mac>` for a waitlist row. `now` is unix ms (injectable for tests). */
export async function mintWaitlistToken(
	secret: string,
	rowId: string,
	now: number = Date.now()
): Promise<string> {
	const exp = Math.floor(now / 1000) + WAITLIST_TOKEN_TTL_SECONDS;
	const key = await hmacKey(secret, 'sign');
	const mac = await crypto.subtle.sign('HMAC', key, message(rowId, exp));
	return `v1.${rowId}.${exp}.${b64url(mac)}`;
}

/**
 * Verify a continuation token → the row id it authorizes, or null for ANY failure (malformed,
 * expired, tampered, wrong secret). crypto.subtle.verify is constant-time, and the id/exp being
 * inside the MAC means a valid token for row A can never authorize row B.
 */
export async function verifyWaitlistToken(
	secret: string,
	token: unknown,
	now: number = Date.now()
): Promise<string | null> {
	if (typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 4 || parts[0] !== 'v1') return null;
	const [, rowId, expStr, macStr] = parts;
	if (rowId.length === 0 || !/^\d+$/.test(expStr)) return null;
	const exp = Number(expStr);
	if (!Number.isSafeInteger(exp) || Math.floor(now / 1000) >= exp) return null;
	const mac = b64urlDecode(macStr);
	if (mac === null) return null;
	const key = await hmacKey(secret, 'verify');
	const ok = await crypto.subtle.verify('HMAC', key, mac, message(rowId, exp));
	return ok ? rowId : null;
}
