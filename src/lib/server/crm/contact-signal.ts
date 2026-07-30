// The `crm-ingest` message contract, HAND-COPIED (DAR-133/DAR-136).
//
// THE CRM DEFINES THIS SHAPE; WE COMPILE AGAINST IT. The single definition lives in the crm-service
// repo at `src/lib/server/contract/contact-signal.ts` and nothing in it imports SvelteKit,
// Cloudflare or a database precisely so a producer can copy it. Until DAR-84 settles the cross-repo
// mechanism for `@darcstar-technologies/*` packages, this file is that copy, and whatever DAR-84
// lands on becomes binding here too — do not invent a second mechanism.
//
// WHAT THE VERSION FIELD BUYS, AND WHAT IT DOES NOT. Every message carries `v`, so a producer
// running ahead of the consumer is a *rejected known version* recorded in `crm_dead_letter`, never a
// silent shape mismatch that half-populates a contact. That covers the SHAPE. It does not cover the
// VOCABULARY: `source` is validated against a registry that lives over there, so renaming
// `website_form` in the CRM would leave this file compiling happily while every message
// dead-lettered as `malformed`. A hand copy cannot catch that, and the failure is at least loud and
// inspectable on the CRM side rather than corrupting a contact — stated here because it is the one
// drift the `v` discipline does not answer.
//
// COPIED NARROW, ON PURPOSE. The CRM's registry holds eight source keys and six identity platforms;
// this copy holds the one source we produce and the one platform it yields. A faithful copy of a
// vocabulary we never emit would be drift surface bought for nothing, whereas narrowing makes "the
// website can only ever claim to be the website form" a fact the compiler holds (DAR-65's move).

/** Bump when the shape changes incompatibly. The consumer rejects versions it does not know. */
export const CONTACT_SIGNAL_VERSION = 1;

/**
 * The only source key this repo produces, and the only identity platform it yields.
 *
 * Both are members of larger CRM-owned unions (`SourceKey`, `Platform`). Narrowing them to literals
 * is what stops a future call site inventing `source: 'linkedin'` from a web form.
 */
export type ProducedSource = 'website_form';
export type ProducedPlatform = 'email';

export interface IdentitySignal {
	platform: ProducedPlatform;
	/** The stable id on that platform. For email, the normalized address. */
	externalId: string;
	handle?: string;
	url?: string;
	display?: string;
	verified?: boolean;
}

/**
 * At least one identity, enforced by the TYPE — DAR-133's "a signal carrying neither an identity nor
 * an email cannot be produced (compile-time if possible)". An email is not a special case: it is an
 * identity with `platform: 'email'`, so requiring a non-empty tuple covers both halves of that rule.
 */
export type NonEmptyIdentities = [IdentitySignal, ...IdentitySignal[]];

/**
 * What goes on the wire.
 *
 * THE ABSENT FIELDS ARE THE POINT. There is no `message`, no `interest`, no IP and no user agent,
 * because the contact graph has no use for them and this shape is what `/privacy` now leans on when
 * it says Twenty receives a name, an email address and a company and not what you wrote. That is a
 * structural guarantee rather than a promise about a call site: a future producer that wanted to
 * send the message body would have to widen the CONTRACT, in the other repo, past its consumer's
 * validator (DAR-65's rubric and DAR-66's funnel row use the same move). `crm-egress.spec.ts` pins
 * it from this side.
 */
export interface ContactSignal {
	v: number;
	source: ProducedSource;
	/**
	 * The originating record's id. With `source` this is the idempotency key
	 * (`crm_ingest UNIQUE(source, source_ref)`), so a redelivered message is a no-op rather than a
	 * second contact. Always set from this repo — every signal we produce has a row behind it.
	 */
	sourceRef: string;
	/** ISO-8601. When the SOURCE observed the signal, never when it was enqueued. */
	occurredAt: string;
	/** Provenance for the rows this creates: `system:<connector>` | `user:<email>` | `import:<batch>`. */
	createdBy: string;
	identities: NonEmptyIdentities;
	/** Convenience mirror of the email identity; the identity row stays authoritative. */
	email?: string;
	displayName?: string;
	givenName?: string;
	familyName?: string;
	/** Captured for later; Organization modeling is deferred CRM-side (DAR-37). */
	company?: string;
}

/**
 * Normalize an address the same way the consumer does, so an identity matches on both sides.
 *
 * NOT A DRIFT HAZARD, which is worth stating because it looks like the worst kind — a copy of a
 * normalizer diverging would silently resolve one person into two contacts, and `v` would not catch
 * it. Measured against the real validator: `parseContactSignal` re-normalizes BOTH the email identity
 * and its mirror with the CRM's own function on arrival, so the consumer's version is authoritative
 * and this one is defence in depth. Don't add a caveat here saying otherwise; do keep the two in
 * agreement anyway, since a signal that arrives already-correct is easier to read in the DLQ.
 */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Build the email identity every form-shaped source produces. */
export function emailIdentity(email: string): IdentitySignal {
	const normalized = normalizeEmail(email);
	return { platform: 'email', externalId: normalized, handle: normalized };
}
