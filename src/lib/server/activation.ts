// Invite-only onboarding (DAR-67) — minting the "set your password" link a staff invite mails out.
//
// Accounts are no longer self-serve (auth-options.ts `disableSignUp`), so an invited prospect needs
// some way to choose a first password. Rather than invent a second credential-setting path, an invite
// mints one of Better Auth's OWN password-reset tokens: the emailed link lands in the existing,
// already-hardened /reset-password flow (single-use, TTL-bounded, other-sessions-revoking), and this
// module owns nothing but the minting. Server-only — it hands out account-takeover-grade links.
//
// The one thing it does NOT inherit from that flow is the lifetime: an invitation is unrequested mail
// that may sit unread for days, so it carries `ACTIVATION_TOKEN_TTL_SECONDS` (a week) rather than the
// self-service reset's hour. That works because expiry is enforced from the verification row, not from
// better-auth's config — see the constant's comment in auth-options.ts.
//
// WHY NOT `auth.api.requestPasswordReset`, which would mint the same token for us — two reasons, both
// load-bearing:
//
//  1. It is rate-limited to 3/hour/IP (auth-options.ts), and correctly so: it is a PUBLIC email-send
//     trigger reachable by anyone. Staff working through a batch of invites are not that threat model,
//     and the fourth invite of an afternoon silently failing is exactly the kind of thing nobody
//     notices. (Calling `auth.api.*` directly would skip the limiter — but see 2.)
//
//  2. It swallows send failures. The endpoint passes `sendResetPassword` to `runInBackgroundOrAwait`,
//     which catches and merely logs anything it throws, then returns `{ status: true }` regardless
//     (context/create-context.mjs). That is right for the anonymous /forgot-password form, which must
//     stay anti-enumerating, and wrong for a staff action, where "did that actually send?" is the
//     whole question. DAR-67 requires the invite to await its send and surface a failure, so the
//     invite action owns the send and this module owns only the token.
//
// It would also mail the wrong thing: `sendResetPassword` is globally bound to the "reset your
// password" copy, and an invitee has no password to reset.
import { ACTIVATION_TOKEN_TTL_SECONDS } from '$lib/server/auth-options';

/**
 * The slice of a Better Auth instance this module needs. Structural rather than
 * `ReturnType<typeof getAuth>` so the round-trip spec can pass a throwaway memory-backed instance —
 * `Auth<Options>` is generic over the whole config, so the live instance and a test one are not the
 * same type even though both expose exactly this. The live instance still has to satisfy it, which
 * `pnpm check` enforces at the invite action's call site.
 */
type AuthLike = {
	$context: Promise<{
		baseURL: string;
		internalAdapter: {
			createVerificationValue(data: {
				identifier: string;
				value: string;
				expiresAt: Date;
			}): Promise<unknown>;
		};
	}>;
};

// Better Auth namespaces reset tokens in the shared `verification` table by prefixing the identifier;
// POST /reset-password consumes exactly `reset-password:<token>` (api/routes/password.mjs). Writing a
// row under that convention is what makes an activation token indistinguishable from a self-service
// reset token to every downstream consumer — which is the point, but it also means this string is a
// coupling to better-auth's internals rather than to its public API. It is pinned by a round-trip
// unit spec (activation.spec.ts): mint here, redeem through `auth.api.resetPassword`, prove the new
// password signs in. If an upgrade ever renames the prefix, that spec fails loudly instead of invites
// dead-ending at "invalid link" in production.
const RESET_TOKEN_IDENTIFIER_PREFIX = 'reset-password:';

/**
 * Where Better Auth's GET /reset-password/:token callback lands the invitee once it has validated the
 * token. Same-origin relative path (the endpoint's originCheck requires that), and it carries the
 * `invite` flag so /reset-password renders "set your password" rather than "reset your password" —
 * an invitee has no old password, and being told to reset one is a small lie that reads like a
 * phishing tell.
 *
 * The flag is COSMETIC ONLY and anyone can append it by hand: it selects copy, never a capability.
 * The token in the URL is the entire authorization, exactly as in the self-service flow.
 */
export const ACTIVATION_CALLBACK_PATH = '/reset-password?invite=1';

/** The query parameter `ACTIVATION_CALLBACK_PATH` sets — read back by /reset-password's load. */
export const ACTIVATION_QUERY_FLAG = 'invite';

/** 256 bits of URL-safe randomness — it rides in a path segment, so base64url, not base64. */
function randomActivationToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface ActivationLink {
	/** The absolute link to email. Validates the token, then redirects to ACTIVATION_CALLBACK_PATH. */
	url: string;
	/** When the token stops working — a week out, and the invite email's copy must agree with this. */
	expiresAt: Date;
}

/**
 * Mint a single-use activation link for `userId`.
 *
 * Deliberately takes a user id rather than an email: the caller has just created (or looked up) the
 * account, and resolving the address a second time here would be a chance to mint a link for a
 * DIFFERENT account than the one the invite reports having invited.
 */
export async function mintActivationLink(auth: AuthLike, userId: string): Promise<ActivationLink> {
	const ctx = await auth.$context;
	const token = randomActivationToken();
	const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_SECONDS * 1000);

	await ctx.internalAdapter.createVerificationValue({
		identifier: `${RESET_TOKEN_IDENTIFIER_PREFIX}${token}`,
		value: userId,
		expiresAt
	});

	// `ctx.baseURL` already includes the /api/auth base path, so this is the same URL shape
	// `requestPasswordReset` builds — read it off the context rather than re-deriving it, or a
	// future basePath change would strand invite links on a 404 while every other flow moved.
	const callback = encodeURIComponent(ACTIVATION_CALLBACK_PATH);
	return { url: `${ctx.baseURL}/reset-password/${token}?callbackURL=${callback}`, expiresAt };
}
