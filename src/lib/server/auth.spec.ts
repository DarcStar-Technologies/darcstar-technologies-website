import { describe, expect, test } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailAndPassword } from './auth-options';

// #48: public email/password sign-up must stay disabled — an open /api/auth/sign-up/email would
// let anyone create accounts in the production DB.
//
// This can't be exercised through the e2e preview: better-auth's isAuthPath() rejects any request
// whose origin differs from the configured baseURL (ORIGIN), and the preview serves on
// localhost:4173 while ORIGIN is the production host — so the endpoint 404s before the auth logic
// runs, regardless of the config. Instead we build a throwaway instance from the SAME
// `emailAndPassword` config the app uses (auth-options.ts), backed by an in-memory adapter, so
// the assertion is hermetic (no DB, no origin, no env) and still guards the real config value.
function buildAuth(opts: typeof emailAndPassword) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		// Seed the core Better Auth models so a real sign-up (the control) has tables to write to.
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: opts
	});
}

const signUp = () =>
	buildAuth(emailAndPassword).api.signUpEmail({
		body: { name: 'probe', email: 'probe@example.com', password: 'a-long-enough-password' }
	});

describe('auth sign-up lockdown (#48)', () => {
	test('our config disables email/password sign-up', async () => {
		await expect(signUp()).rejects.toThrow(/sign up is not enabled/i);
	});

	// Control: the same call with sign-up enabled is NOT rejected as disabled — proves the
	// rejection above comes from disableSignUp, not some unrelated misconfiguration.
	test('control: sign-up succeeds when enabled', async () => {
		const res = await buildAuth({ enabled: true, disableSignUp: false }).api.signUpEmail({
			body: { name: 'probe', email: 'control@example.com', password: 'a-long-enough-password' }
		});
		expect(res.user.email).toBe('control@example.com');
	});
});
