import { describe, expect, test } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { admin } from 'better-auth/plugins';

// Roster management (the admin plugin) authorizes by role or the ADMIN_USER_IDS allowlist. Like
// auth.spec.ts, this is hermetic: throwaway Better Auth instances over an in-memory adapter, no DB,
// no env, no origin. Two instances can share ONE `db` object (the same arrays), which lets a
// sign-up-DISABLED "live" instance operate on accounts seeded by a sign-up-ENABLED one — exactly
// the app's shape (public sign-up is off, but the admin endpoints still create/manage users).

const SECRET = 'test-secret-value-at-least-32-characters-long';
const PASSWORD = 'a-long-enough-password';

type Store = Parameters<typeof memoryAdapter>[0];
const emptyStore = (): Store => ({ user: [], session: [], account: [], verification: [] });

function build(db: Store, opts: Parameters<typeof admin>[0], disableSignUp = false) {
	return betterAuth({
		baseURL: 'http://localhost',
		secret: SECRET,
		database: memoryAdapter(db),
		emailAndPassword: { enabled: true, disableSignUp },
		plugins: [admin(opts)]
	});
}

// Sign in and return the `name=value` session-token cookie to replay on later admin calls.
async function sessionCookie(auth: ReturnType<typeof build>, email: string): Promise<string> {
	const res = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
	const set =
		typeof res.headers.getSetCookie === 'function'
			? res.headers.getSetCookie()
			: [res.headers.get('set-cookie') ?? ''];
	const token = set.find((c) => /session_token=/.test(c));
	if (!token) throw new Error('no session cookie in sign-in response');
	return token.split(';')[0];
}

const headersFor = (cookie: string) => new Headers({ cookie });

describe('admin roster (user management)', () => {
	test('a plain operator (role: user) cannot list or create users', async () => {
		const db = emptyStore();
		const auth = build(db, { defaultRole: 'user' });
		await auth.api.signUpEmail({
			body: { name: 'op', email: 'op@example.com', password: PASSWORD }
		});
		const headers = headersFor(await sessionCookie(auth, 'op@example.com'));

		await expect(auth.api.listUsers({ query: {}, headers })).rejects.toThrow(
			/not allowed to list users/i
		);
		await expect(
			auth.api.createUser({
				body: { name: 'x', email: 'x@example.com', password: PASSWORD },
				headers
			})
		).rejects.toThrow(/not allowed to create users/i);
	});

	test('an ADMIN_USER_IDS owner can list and create — even though public sign-up is disabled', async () => {
		const db = emptyStore();
		// Seed the owner with a sign-up-enabled instance, then run the "live" one with sign-up OFF.
		const owner = await build(db, { defaultRole: 'user' }).api.signUpEmail({
			body: { name: 'owner', email: 'owner@example.com', password: PASSWORD }
		});
		const auth = build(db, { adminUserIds: [owner.user.id], defaultRole: 'user' }, true);
		const headers = headersFor(await sessionCookie(auth, 'owner@example.com'));

		// Mirror the roster load's exact query (limit + sortBy/sortDirection) so an invalid sort
		// field would fail here, not with a 500 on /admin/users.
		const list = await auth.api.listUsers({
			query: { limit: 200, sortBy: 'createdAt', sortDirection: 'desc' },
			headers
		});
		expect(list.users.length).toBeGreaterThanOrEqual(1);

		// createUser is an ADMIN op, so it succeeds despite disableSignUp...
		const created = await auth.api.createUser({
			body: { name: 'new', email: 'new@example.com', password: PASSWORD },
			headers
		});
		expect(created.user.email).toBe('new@example.com');

		// ...while public sign-up itself stays closed (control).
		await expect(
			auth.api.signUpEmail({
				body: { name: 'nope', email: 'nope@example.com', password: PASSWORD }
			})
		).rejects.toThrow(/sign up is not enabled/i);
	});

	test('a role:admin operator can manage the roster without being allowlisted', async () => {
		const db = emptyStore();
		const owner = await build(db, { defaultRole: 'user' }).api.signUpEmail({
			body: { name: 'owner', email: 'owner@example.com', password: PASSWORD }
		});
		const auth = build(db, { adminUserIds: [owner.user.id], defaultRole: 'user' }, true);
		const ownerHeaders = headersFor(await sessionCookie(auth, 'owner@example.com'));

		// Owner creates a second account directly as an admin (role, not allowlist).
		await auth.api.createUser({
			body: { name: 'a2', email: 'admin2@example.com', password: PASSWORD, role: 'admin' },
			headers: ownerHeaders
		});
		const adminHeaders = headersFor(await sessionCookie(auth, 'admin2@example.com'));

		const list = await auth.api.listUsers({ query: {}, headers: adminHeaders });
		expect(list.users.length).toBeGreaterThanOrEqual(2);
	});
});
