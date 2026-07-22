import { describe, expect, test, vi } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { APIError } from 'better-auth/api';
import {
	createLoginAuditHook,
	mapSignInOutcome,
	normalizeEmail,
	type LoginAuditRecord
} from './auth-audit';

// The login audit records every sign-in ATTEMPT. Two layers of coverage:
//   1. `mapSignInOutcome` — pure: the success/failure + reason mapping, in isolation.
//   2. The real `createLoginAuditHook` wired as `hooks.after` on a throwaway in-memory Better Auth
//      instance (same hermetic pattern as auth.spec.ts) — proves the hook fires on both a failed and a
//      successful `signInEmail`, extracts the email + raw IP, and links the user id on success. No DB,
//      no env: the env-bound persistence (login-audit-store.ts) is swapped for an in-memory collector.

describe('mapSignInOutcome', () => {
	test('success: a plain result object → success, 200, no reason', () => {
		expect(mapSignInOutcome({ token: 'x', user: { id: 'u1' } })).toEqual({
			success: true,
			status: 200,
			reason: null
		});
	});

	test('failure: bad-credentials APIError → invalid_credentials + 401', () => {
		const err = new APIError('UNAUTHORIZED', {
			code: 'INVALID_EMAIL_OR_PASSWORD',
			message: 'nope'
		});
		expect(mapSignInOutcome(err)).toEqual({
			success: false,
			status: 401,
			reason: 'invalid_credentials'
		});
	});

	test('failure: banned APIError → banned + 403', () => {
		const err = new APIError('FORBIDDEN', { code: 'BANNED_USER', message: 'banned' });
		expect(mapSignInOutcome(err)).toEqual({ success: false, status: 403, reason: 'banned' });
	});
});

describe('normalizeEmail', () => {
	test('trims + lowercases; blank/non-string → null', () => {
		expect(normalizeEmail('  Op@Example.com ')).toBe('op@example.com');
		expect(normalizeEmail('')).toBeNull();
		expect(normalizeEmail('   ')).toBeNull();
		expect(normalizeEmail(undefined)).toBeNull();
	});
});

function buildAuth() {
	const records: LoginAuditRecord[] = [];
	const auth = betterAuth({
		baseURL: 'http://localhost',
		secret: 'test-secret-value-at-least-32-characters-long',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		// Sign-up enabled here only so the tests can seed a user to sign in AS; the real app keeps it
		// disabled (auth-options.ts / auth.spec.ts). The hook ignores the /sign-up/email path anyway.
		emailAndPassword: { enabled: true, disableSignUp: false },
		hooks: { after: createLoginAuditHook((r) => records.push(r)) }
	});
	return { auth, records };
}

describe('createLoginAuditHook (wired as hooks.after)', () => {
	test('records a FAILURE on a bad password (no session, generic reason)', async () => {
		const { auth, records } = buildAuth();
		await auth.api.signUpEmail({
			body: { name: 'Op', email: 'op@example.com', password: 'a-long-enough-password' }
		});
		records.length = 0; // ignore anything from the sign-up path

		// Silence the expected console.warn from logLoginAttempt for a clean test run.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(
			auth.api.signInEmail({
				body: { email: 'op@example.com', password: 'wrong-password' },
				headers: new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'probe/1.0' })
			})
		).rejects.toThrow();
		warn.mockRestore();

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			success: false,
			email: 'op@example.com',
			reason: 'invalid_credentials',
			status: 401,
			ipAddress: '203.0.113.7',
			userAgent: 'probe/1.0',
			userId: null
		});
	});

	test('records a SUCCESS with the resolved userId + IP on good credentials', async () => {
		const { auth, records } = buildAuth();
		const signUp = await auth.api.signUpEmail({
			body: { name: 'Op', email: 'op2@example.com', password: 'a-long-enough-password' }
		});
		records.length = 0;

		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		await auth.api.signInEmail({
			body: { email: 'op2@example.com', password: 'a-long-enough-password' },
			headers: new Headers({ 'x-forwarded-for': '198.51.100.9' })
		});
		info.mockRestore();

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			success: true,
			email: 'op2@example.com',
			reason: null,
			ipAddress: '198.51.100.9',
			userId: signUp.user.id
		});
	});
});
