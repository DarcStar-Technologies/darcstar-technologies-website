import { describe, expect, test } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailAndPassword } from './auth-options';

// #96 (PR 2): public email/password sign-up is now OPEN — reversing the #48 lockdown — but gated. A
// sign-up creates an UNVERIFIED account and does NOT sign the visitor in; `requireEmailVerification`
// then blocks sign-IN until the email is confirmed. (Cloudflare Turnstile is the other gate, but it's
// an onRequest plugin needing a live siteverify call, so it's out of scope for this hermetic test.)
//
// This can't be exercised through the e2e preview: better-auth's isAuthPath() rejects any request
// whose origin differs from the configured baseURL (ORIGIN), and the preview serves on localhost:4173
// while ORIGIN is the production host — so the endpoint 404s before the auth logic runs. Instead we
// build a throwaway instance from the SAME `emailAndPassword` config the app uses (auth-options.ts),
// backed by an in-memory adapter, so the assertions are hermetic (no DB, no origin, no env) and guard
// the real config values: that sign-up is enabled AND that verification is required to sign in.
function buildAuth(opts: typeof emailAndPassword) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		// Seed the core Better Auth models so a real sign-up has tables to write to.
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: opts
	});
}

const PASSWORD = 'a-long-enough-password';

describe('auth public sign-up + email verification (#96 PR2)', () => {
	test('our config allows sign-up, but leaves the account unverified and not signed in', async () => {
		const res = await buildAuth(emailAndPassword).api.signUpEmail({
			body: { name: 'probe', email: 'probe@example.com', password: PASSWORD }
		});
		// Sign-up is no longer locked down (#48 reversed).
		expect(res.user.email).toBe('probe@example.com');
		// requireEmailVerification → the new account starts unverified and gets no session token.
		expect(res.user.emailVerified).toBe(false);
		expect(res.token).toBeNull();
	});

	test('our config blocks sign-in until the email is verified', async () => {
		const auth = buildAuth(emailAndPassword);
		await auth.api.signUpEmail({
			body: { name: 'probe', email: 'verify@example.com', password: PASSWORD }
		});
		// Correct password, but unverified → rejected as EMAIL_NOT_VERIFIED (not a credentials error).
		await expect(
			auth.api.signInEmail({ body: { email: 'verify@example.com', password: PASSWORD } })
		).rejects.toThrow(/verif/i);
	});

	// Control: with verification NOT required, the same account can sign in immediately — proving the
	// block above comes from requireEmailVerification, not some unrelated misconfiguration.
	test('control: sign-in succeeds when verification is not required', async () => {
		const auth = buildAuth({
			enabled: true,
			disableSignUp: false,
			requireEmailVerification: false
		});
		await auth.api.signUpEmail({
			body: { name: 'probe', email: 'control@example.com', password: PASSWORD }
		});
		const res = await auth.api.signInEmail({
			body: { email: 'control@example.com', password: PASSWORD }
		});
		expect(res.user.email).toBe('control@example.com');
	});
});
