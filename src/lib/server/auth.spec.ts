import { describe, expect, test } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { admin } from 'better-auth/plugins';
import { emailAndPassword } from './auth-options';

// DAR-67: public email/password sign-up is CLOSED again (`disableSignUp`) — accounts are invite-only,
// minted by staff from /admin/waitlist. #96 PR 2's gates (`requireEmailVerification`, Turnstile) were
// the previous regime; verification stays on for the accounts that predate the lockdown, and the
// captcha plugin is gone with the form it guarded.
//
// This can't be exercised through the e2e preview: better-auth's isAuthPath() rejects any request
// whose origin differs from the configured baseURL (ORIGIN), and the preview serves on localhost:4173
// while ORIGIN is the production host — so the endpoint 404s before the auth logic runs. Instead we
// build a throwaway instance from the SAME `emailAndPassword` config the app uses (auth-options.ts),
// backed by an in-memory adapter, so the assertions are hermetic (no DB, no origin, no env) and guard
// the real config values: that public sign-up is refused, that the staff path is NOT, and that
// verification is still required to sign in.
function buildAuth(opts: typeof emailAndPassword) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		// Seed the core Better Auth models so a real sign-up has tables to write to.
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: opts,
		// The roster + invite paths both go through this plugin's create-user endpoint, so the lockdown
		// tests need it registered to prove the staff route survives. Mirrors auth.ts's `defaultRole`.
		plugins: [admin({ adminRoles: ['admin'], defaultRole: 'user' })]
	});
}

// Registration as it stands OPEN — the only difference from the shipped config is the one flag. Used
// by fixtures that must MAKE an account the normal way (a legacy unverified user, say) and by the
// controls that prove the flag, not some incidental default, is what closes the door.
const openSignUp = { ...emailAndPassword, disableSignUp: false };

const PASSWORD = 'a-long-enough-password';

// A throwaway instance wired with a RECORDING `sendVerificationEmail`. Two reasons: it (a) enables the
// `/send-verification-email` endpoint (better-auth 400s "not enabled" without the callback) so the
// #115 resend affordance can be exercised, and (b) lets a test assert exactly WHICH addresses actually
// triggered a send. `sendOnSignUp` records the sign-up mail too (tests clear the sink before probing).
//
// Uses `openSignUp` rather than the shipped config for one reason: the fixture has to CREATE an
// unverified account, and DAR-67's lockdown refuses the only ordinary way to make one. It keeps
// `requireEmailVerification: true`, which is the part that matters — this suite is about the
// unverified-account regime, and that regime still exists for everyone who registered before the
// lockdown. Those are precisely the users the resend affordance now serves.
function buildAuthWithVerifySink(sink: { email: string; url: string }[]) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: openSignUp,
		emailVerification: {
			sendOnSignUp: true,
			sendVerificationEmail: async ({ user, url }) => {
				sink.push({ email: user.email, url });
			}
		}
	});
}

describe('auth registration is invite-only (DAR-67)', () => {
	// THE BOUNDARY. Hiding /signup is cosmetic; this is the line that actually closes registration, so
	// it is asserted against the very config object auth.ts spreads into the live instance.
	test('our config refuses public sign-up outright', async () => {
		await expect(
			buildAuth(emailAndPassword).api.signUpEmail({
				body: { name: 'probe', email: 'probe@example.com', password: PASSWORD }
			})
		).rejects.toThrow(/sign up is not enabled/i);
	});

	// The other half, and the half a lockdown can silently break: staff must still be able to mint
	// accounts, or invite-only onboarding has no onboarding. `disableSignUp` is checked by the
	// /sign-up/email route only — the admin plugin's create-user is a different endpoint that never
	// consults it — but "these two flags live in different files and happen not to interact" is exactly
	// the sort of thing an upgrade changes.
	test('the staff path still mints accounts, already verified', async () => {
		const auth = buildAuth(emailAndPassword);
		const created = await auth.api.createUser({
			body: {
				email: 'invited@example.com',
				name: 'Invitee',
				password: PASSWORD,
				role: 'user',
				data: { emailVerified: true }
			}
		});
		expect(created.user.email).toBe('invited@example.com');
		// Verified at creation, or `requireEmailVerification` would 403 the invitee at their first
		// sign-in — with no way out, since nobody sent them a verification link.
		expect(created.user.emailVerified).toBe(true);
	});

	// A staff-minted account is immediately usable. This is the acceptance criterion "an invited
	// prospect can sign in" reduced to its auth-layer core (the password swap is activation.spec.ts).
	test('a staff-minted account can sign in straight away', async () => {
		const auth = buildAuth(emailAndPassword);
		await auth.api.createUser({
			body: {
				email: 'usable@example.com',
				name: 'Invitee',
				password: PASSWORD,
				role: 'user',
				data: { emailVerified: true }
			}
		});
		const res = await auth.api.signInEmail({
			body: { email: 'usable@example.com', password: PASSWORD }
		});
		expect(res.user.email).toBe('usable@example.com');
	});

	// Control: flip the ONE flag and sign-up works again — proving the refusal above is `disableSignUp`
	// and not some unrelated misconfiguration that would also block the staff path.
	test('control: sign-up succeeds with disableSignUp off', async () => {
		const res = await buildAuth(openSignUp).api.signUpEmail({
			body: { name: 'probe', email: 'control@example.com', password: PASSWORD }
		});
		expect(res.user.email).toBe('control@example.com');
		// Still unverified + unsigned-in under requireEmailVerification, as it was under #96 PR 2.
		expect(res.user.emailVerified).toBe(false);
		expect(res.token).toBeNull();
	});

	// Unchanged by the lockdown and still load-bearing: accounts created BEFORE it (self-registrants
	// who never clicked their link) are unverified and must stay locked out — which is what makes the
	// #115 resend affordance in LoginForm the only way back in for them.
	test('sign-in still requires a verified email', async () => {
		const auth = buildAuth(openSignUp);
		await auth.api.signUpEmail({
			body: { name: 'probe', email: 'verify@example.com', password: PASSWORD }
		});
		// Correct password, but unverified → rejected as EMAIL_NOT_VERIFIED (not a credentials error).
		await expect(
			auth.api.signInEmail({ body: { email: 'verify@example.com', password: PASSWORD } })
		).rejects.toThrow(/verif/i);
	});

	// #115 resend-verification affordance. The signup "check your email" panel forwards to
	// POST /send-verification-email, which MUST stay non-enumerating: an attacker probing addresses
	// can't be allowed to tell "unverified account exists" from "no account / already verified". These
	// pin better-auth's guarantee (email-verification.mjs) — identical `{ status: true }` for every
	// case, with a real mail sent ONLY to an existing unverified account — so an upgrade can't regress it.
	test('resend: identical response for absent vs unverified, and mails only the real unverified account', async () => {
		const sent: { email: string; url: string }[] = [];
		const auth = buildAuthWithVerifySink(sent);
		await auth.api.signUpEmail({
			body: { name: 'u', email: 'unverified@example.com', password: PASSWORD }
		});
		sent.length = 0; // drop the sign-up mail so the sink shows only what the resends triggered

		// Probe an address with no account, then the real unverified one (different case, to prove the
		// match is by normalized email). The client-visible response must be indistinguishable.
		const absent = await auth.api.sendVerificationEmail({ body: { email: 'nobody@example.com' } });
		const existing = await auth.api.sendVerificationEmail({
			body: { email: 'UNVERIFIED@example.com' }
		});
		expect(absent.status).toBe(true);
		expect(existing.status).toBe(true);
		// ...but only the existing, unverified account actually received a link.
		expect(sent.map((e) => e.email)).toEqual(['unverified@example.com']);
	});

	test('resend: an already-verified account gets the same generic response but no new mail', async () => {
		const sent: { email: string; url: string }[] = [];
		const auth = buildAuthWithVerifySink(sent);
		await auth.api.signUpEmail({
			body: { name: 'v', email: 'verified@example.com', password: PASSWORD }
		});
		// Verify the account using the token from the sign-up mail, then isolate the resend.
		const token = new URL(sent[0].url).searchParams.get('token');
		expect(token).toBeTruthy();
		await auth.api.verifyEmail({ query: { token: token as string } });
		sent.length = 0;

		const res = await auth.api.sendVerificationEmail({ body: { email: 'verified@example.com' } });
		expect(res.status).toBe(true); // same response as the unverified/absent cases above
		expect(sent).toEqual([]); // ...but nothing re-sent to an already-verified address
	});
});

// A throwaway instance wired with a RECORDING `sendResetPassword` — this both ENABLES the
// request-password-reset endpoint (better-auth 400s "reset password isn't enabled" without the
// callback) and lets a test assert which addresses actually triggered a send, and capture the reset
// token. `requireEmailVerification` is left OFF here so a test can sign in to prove the NEW password
// works — the reset flow itself doesn't depend on verification.
function buildAuthWithResetSink(sink: { email: string; token: string }[]) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ user, token }) => {
				sink.push({ email: user.email, token });
			}
		}
	});
}

describe('auth password reset (self-service)', () => {
	// Anti-enumeration: a reset request must be indistinguishable whether or not the address has an
	// account (better-auth simulates the token path for unknown emails — password.mjs). This pins the
	// identical response AND that a mail fires only for the real account, so the /forgot-password form
	// (which always shows a generic "check your email") can't be used to enumerate registered emails.
	test('request: identical response for absent vs existing, mails only the real account', async () => {
		const sent: { email: string; token: string }[] = [];
		const auth = buildAuthWithResetSink(sent);
		await auth.api.signUpEmail({
			body: { name: 'u', email: 'reset@example.com', password: PASSWORD }
		});
		sent.length = 0;

		const absent = await auth.api.requestPasswordReset({ body: { email: 'nobody@example.com' } });
		const existing = await auth.api.requestPasswordReset({ body: { email: 'reset@example.com' } });
		expect(absent.status).toBe(true);
		expect(existing.status).toBe(true);
		expect(sent.map((e) => e.email)).toEqual(['reset@example.com']);
	});

	test('reset: a valid token sets the new password (old one stops working); a bad token is rejected', async () => {
		const sent: { email: string; token: string }[] = [];
		const auth = buildAuthWithResetSink(sent);
		await auth.api.signUpEmail({
			body: { name: 'u', email: 'chpw@example.com', password: PASSWORD }
		});
		await auth.api.requestPasswordReset({ body: { email: 'chpw@example.com' } });
		const token = sent.at(-1)?.token;
		expect(token).toBeTruthy();

		const NEW_PASSWORD = 'a-brand-new-password';
		const res = await auth.api.resetPassword({
			body: { newPassword: NEW_PASSWORD, token: token as string }
		});
		expect(res.status).toBe(true);

		// The new password now signs in; the old one no longer does.
		const signIn = await auth.api.signInEmail({
			body: { email: 'chpw@example.com', password: NEW_PASSWORD }
		});
		expect(signIn.user.email).toBe('chpw@example.com');
		await expect(
			auth.api.signInEmail({ body: { email: 'chpw@example.com', password: PASSWORD } })
		).rejects.toThrow();

		// The now-consumed token can't be reused, and a bogus token is rejected too.
		await expect(
			auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token: token as string } })
		).rejects.toThrow(/token/i);
		await expect(
			auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token: 'not-a-real-token' } })
		).rejects.toThrow(/token/i);
	});

	test('control: request-password-reset requires the sendResetPassword callback (our config wires it)', async () => {
		// Without the callback the endpoint is disabled — proving our real config (auth.ts) is what
		// enables reset, not an incidental default.
		const auth = betterAuth({
			baseURL: 'http://localhost',
			secret: 'test-secret-value-at-least-32-characters-long',
			database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
			emailAndPassword: { enabled: true }
		});
		await expect(
			auth.api.requestPasswordReset({ body: { email: 'x@example.com' } })
		).rejects.toThrow();
	});
});
