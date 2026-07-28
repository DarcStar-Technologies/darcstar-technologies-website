// The ONE place the waitlist's signing secret comes from (DAR-99).
//
// THE GAP THIS CLOSES. All four of the flow's signed values — the continuation token (`v1`), the flow
// claim (`f1`), the resume cookie (`r1`) and the funnel handle (`n1`) — are MINTED IN ONE MODULE AND
// VERIFIED IN ANOTHER: the load mints a token that a step verifies, step 2 mints a claim that step 3
// verifies, and so on. Their domain and prefix are module-private constants used by both ends, so
// those cannot drift. The SECRET was the one input each end resolved for itself — seven call sites,
// each writing `readEnv('BETTER_AUTH_SECRET')` out longhand.
//
// Nothing proved they agreed, and nothing could: every unit spec round-trips mint → verify INSIDE one
// module with the secret passed in as a parameter, and the hermetic e2e has no reachable database, so
// the enrich and the funnel insert are no-ops there while the token and claim are asserted only by
// SHAPE in the rendered hidden fields. Two gates that fail closed into something that reads like a
// pass — the DAR-81 pattern.
//
// A mismatch would also be silent in production, in four different ways, none of them an error anyone
// sees: the funnel would record views and nothing else (reading as "nobody converts"), steps 2–4 would
// quietly stop enriching, every visitor would route to branch B and get the least-committal CTA, and
// reloads would drop back to the blank form (DAR-75 regressing invisibly).
//
// WHY A TYPE AND NOT A TEST. One resolver already makes a RENAME safe — there is a single expression
// to change. It does not stop the other two drifts the ticket named: a per-purpose secret introduced
// at one end, or a new entry point resolving the key for itself. Both compile fine against
// `secret: string`. So the secret is BRANDED and every mint/verify takes the brand, which makes each
// of those a compile error at the offending call site rather than a silent production failure — the
// same move `WaitlistFlowId` makes for the flow id (DAR-86) and `WaitlistLeadSignals` makes for the
// money columns (DAR-65). It is erased at runtime, so a cast still defeats it; `waitlist-secret.spec.ts`
// is the backstop for that, and the cast is the thing to question in review.
//
// WHY THIS IS ITS OWN MODULE rather than a function beside the signing core: `readEnv` reaches for
// `$app/server`, and the four signing modules are deliberately request-free — they take the secret as
// a parameter, which is what lets their specs round-trip mint → verify with no request in flight.
// Importing the BRAND there costs nothing (a type import is erased), but importing this FUNCTION
// there would not, and that boundary enforces itself: a signing module that resolved its own secret
// would call `getRequestEvent()` outside a request and take its entire spec red. Verified, not
// assumed — mutating `mintWaitlistToken` to resolve for itself fails 6 of its 12 tests.
//
// The key is deliberately Better Auth's own (`auth.ts` reads it too, for sessions) rather than a
// second secret to provision — the per-value domain separation inside `mintSignedValue` is what makes
// sharing it safe. Repointing this function at some other variable would keep the four values
// consistent with each other but would quietly end that reuse, so it is a decision, not a rename.
import { readEnv } from './env';

/**
 * A secret we vouch for as THE waitlist signing secret — i.e. one that came from the resolver below.
 *
 * The brand is the guard (DAR-99). Every mint and verify across the four values takes this rather
 * than a bare `string`, so a call site that resolved its own secret — a per-purpose key, a new entry
 * point reaching for `readEnv` directly — does not type-check. That turns "do both ends of this
 * request agree?" into a question the compiler answers, which matters because every way of getting it
 * wrong is invisible at runtime.
 */
export type WaitlistSigningSecret = string & { readonly __waitlistSigningSecret: unique symbol };

/**
 * Resolve the signing secret for this request. `undefined` when the deploy has none — every caller
 * already treats that as "this feature is off" rather than an error: no continuation token, no
 * resume, no enrich, and no funnel (uniformly dark, DAR-86).
 *
 * MUST be called inside a request, like every `readEnv` — on workerd the value lives in the
 * per-request `platform.env` and a module-load read comes back empty.
 *
 * An empty string is passed through rather than normalized to `undefined`: every call site gates on
 * truthiness (`if (!secret)`), so the two are already the same thing downstream, and narrowing here
 * would be a behaviour change dressed up as a type fix.
 */
export function waitlistSigningSecret(): WaitlistSigningSecret | undefined {
	return readEnv('BETTER_AUTH_SECRET') as WaitlistSigningSecret | undefined;
}
