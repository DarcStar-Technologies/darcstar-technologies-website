import { beforeEach, describe, expect, it, vi } from 'vitest';

// The roster's `create` action (DAR-226) — the one place in the app where an account is minted with a
// role chosen from a form field, and the one that bypasses the public-sign-up lockout (#48) by
// design, since it calls the better-auth admin endpoint rather than `/sign-up/email`.
//
// SvelteKit does NOT run the layout guard before a form action, only on the re-render, so the
// `rosterAdmin(locals)` line is the whole authorization boundary. See the header of
// `../waitlist/page.server.spec.ts` for what DAR-140 measured a missing one to look like.
//
// `rosterAdmin` is deliberately NOT mocked — the real predicate runs.

vi.mock('$lib/server/env', () => ({ readEnv: () => undefined }));

const createUser = vi.fn();
const linkSubmissionsToUser = vi.fn();

vi.mock('$lib/server/auth', () => ({ getAuth: () => ({ api: { createUser } }) }));
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/contact-ownership', () => ({ linkSubmissionsToUser }));

const { actions } = await import('./+page.server');

type Actor = { id: string; role: string | null } | null;

const call = (user: Actor, fields: Record<string, string> = {}) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	const event = {
		request: { formData: async () => data, headers: new Headers() },
		locals: { user }
	} as unknown as Parameters<NonNullable<(typeof actions)['create']>>[0];
	return actions.create!(event);
};

/** `create` signals success by THROWING a redirect to the new account's detail page. */
const settle = async (pending: unknown) => {
	try {
		return await pending;
	} catch (thrown) {
		return thrown;
	}
};

const ADMIN: Actor = { id: 'boss-1', role: 'admin' };
const OPERATOR: Actor = { id: 'staff-1', role: 'operator' };
const SIGNED_IN_USER: Actor = { id: 'someone', role: 'user' };
const VALID = { email: 'ada@example.com', name: 'Ada', password: 'a-long-enough-one' };

beforeEach(() => {
	vi.clearAllMocks();
	createUser.mockResolvedValue({ user: { id: 'new-1' } });
});

describe('create', () => {
	it('admits a roster admin and lands on the new account', async () => {
		const thrown = await settle(call(ADMIN, VALID));

		expect(createUser).toHaveBeenCalled();
		expect(thrown).toMatchObject({ status: 303, location: '/admin/users/new-1' });
	});

	// THE PAIR, and the OPERATOR row is the one that discriminates. They pass `isStaff` and fail
	// `isRosterAdmin`, which is exactly the narrowing this page depends on — an operator who could
	// mint accounts could mint an `admin` one and promote themselves, so the roster is admin-only
	// while the sibling /admin message triage is not. An end-user and an anonymous caller are refused
	// by either predicate, so they cannot tell the two apart; only this row can.
	it.each([
		['an operator', OPERATOR],
		['a signed-in end-user', SIGNED_IN_USER],
		['an anonymous caller', null]
	])('refuses %s without creating an account', async (_label, user) => {
		const result = await settle(call(user, VALID));

		expect(result).toMatchObject({ status: 403 });
		expect(createUser).not.toHaveBeenCalled();
		expect(linkSubmissionsToUser).not.toHaveBeenCalled();
	});

	// Least privilege on the one field a caller controls that decides what the new account can do.
	// `coerceRole` falls back rather than throwing, so the fallback IS the policy: an unrecognized
	// role must not land as-is (better-auth stores `role` as a free string, so an unvalidated value
	// would be written verbatim) and must not land as something privileged.
	it('coerces an unrecognized role down to the end-user one', async () => {
		await settle(call(ADMIN, { ...VALID, role: 'superuser' }));

		expect(createUser).toHaveBeenCalledWith(
			expect.objectContaining({ body: expect.objectContaining({ role: 'user' }) })
		);
	});

	it.each([
		['a missing email', { ...VALID, email: '' }],
		['a missing name', { ...VALID, name: '' }],
		['a password under eight characters', { ...VALID, password: 'short' }]
	])('refuses %s', async (_label, fields) => {
		const result = await settle(call(ADMIN, fields));

		expect(result).toMatchObject({ status: 400 });
		expect(createUser).not.toHaveBeenCalled();
	});
});
