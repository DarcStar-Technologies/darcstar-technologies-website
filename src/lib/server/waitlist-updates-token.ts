// The two links inside the updates confirmation email (DAR-139) — "yes, send them" and "don't ask
// again". Both are signed values over the LEAD id, minted by the mailer and verified by the route the
// recipient lands on.
//
// Fifth and sixth values on the shared signing core (`mintSignedValue`/`verifySignedValue`,
// waitlist-token.ts), so they inherit its canonicalization, its constant-time compare and its rule that
// a value minted for one purpose can never verify as another. They take the branded
// `WaitlistSigningSecret` (DAR-99) for the reason that brand exists: each is minted in one module and
// verified in a different one, and a secret resolved independently at either end would fail SILENTLY —
// a null verification reads exactly like an expired link.
//
// TWO VALUES RATHER THAN ONE WITH A MODE, and the TTLs are the argument. A confirmation authorizes a
// GRANT, so the intent behind it goes stale — a week, matching DAR-67's invitation, which is the same
// shape of thing (an emailed capability a person is expected to act on soon). An unsubscribe authorizes
// only a REMOVAL, and it has to work whenever the mail is found, so it gets a year. That is DAR-98's
// rule applied rather than copied: a TTL is sized to what the capability is FOR, and here the two are
// not the same capability. Folding them into one token would hand the grant the removal's lifetime,
// which is the wrong half to be generous with.
//
// Neither is a secret to provision: both key off `BETTER_AUTH_SECRET` via `waitlistSigningSecret()`,
// domain-separated inside the core like the four flow values.
import type { WaitlistSigningSecret } from './waitlist-secret';
import { mintSignedValue, verifySignedValue } from './waitlist-token';

/**
 * A confirmation link's life. Long enough to survive a weekend and a full inbox; short enough that the
 * click still means "I want this", which is the only thing it is evidence of.
 */
export const WAITLIST_UPDATES_CONFIRM_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * An unsubscribe link's life — a year, because the mail carrying it sits in an inbox indefinitely and a
 * withdrawal that has expired is a withdrawal that doesn't work. Still an expiry rather than none: the
 * signing core requires one, and a value that can never age out is a permanent bearer artifact.
 */
export const WAITLIST_UPDATES_UNSUBSCRIBE_TTL_SECONDS = 365 * 24 * 60 * 60;

const CONFIRM_DOMAIN = 'darcstar:waitlist-updates-confirm:v1';
const CONFIRM_PREFIX = 'c1';
const UNSUBSCRIBE_DOMAIN = 'darcstar:waitlist-updates-unsubscribe:v1';
const UNSUBSCRIBE_PREFIX = 'u1';

/** Mint `c1.<leadId>.<exp>.<mac>`. `now` is unix ms (injectable for tests). */
export function mintUpdatesConfirmToken(
	secret: WaitlistSigningSecret,
	leadId: string,
	now: number = Date.now()
): Promise<string> {
	return mintSignedValue(
		secret,
		CONFIRM_DOMAIN,
		CONFIRM_PREFIX,
		leadId,
		WAITLIST_UPDATES_CONFIRM_TTL_SECONDS,
		now
	);
}

/**
 * Verify a confirmation link → the lead id it authorizes, or null for ANY failure (malformed, expired,
 * tampered, wrong secret, or an unsubscribe token presented here).
 *
 * Callers render one generic panel for null, whatever the cause — the continuation token's rule. The id
 * is an opaque UUID and authorizes nothing without the MAC, so the value is safe to carry in a URL; the
 * site's `strict-origin-when-cross-origin` referrer policy keeps it from leaving the origin.
 */
export function verifyUpdatesConfirmToken(
	secret: WaitlistSigningSecret,
	token: unknown,
	now: number = Date.now()
): Promise<string | null> {
	return verifySignedValue(secret, CONFIRM_DOMAIN, CONFIRM_PREFIX, token, now);
}

/** Mint `u1.<leadId>.<exp>.<mac>`. `now` is unix ms (injectable for tests). */
export function mintUpdatesUnsubscribeToken(
	secret: WaitlistSigningSecret,
	leadId: string,
	now: number = Date.now()
): Promise<string> {
	return mintSignedValue(
		secret,
		UNSUBSCRIBE_DOMAIN,
		UNSUBSCRIBE_PREFIX,
		leadId,
		WAITLIST_UPDATES_UNSUBSCRIBE_TTL_SECONDS,
		now
	);
}

/** Verify an unsubscribe link → the lead id it authorizes, or null. See the confirm twin. */
export function verifyUpdatesUnsubscribeToken(
	secret: WaitlistSigningSecret,
	token: unknown,
	now: number = Date.now()
): Promise<string | null> {
	return verifySignedValue(secret, UNSUBSCRIBE_DOMAIN, UNSUBSCRIBE_PREFIX, token, now);
}
