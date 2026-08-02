import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';

// The /account portal's two form actions (DAR-226): change your display name, change your password.
//
// SvelteKit does NOT run the layout guard before a form action, only on the re-render, so the
// `locals.user` line inside each action is the whole authorization boundary. See the header of
// `../admin/waitlist/page.server.spec.ts` for what DAR-140 measured a missing one to look like from
// outside — a `303` that reads exactly like a refusal while the write has already landed.
//
// This is the ONE gated surface in the app whose predicate is "signed in" and nothing more, which is
// the interesting half: /admin bounces an end-user here, so a gate copied from there would lock out
// precisely the people the portal exists for. Asserted as a pair below.

const updateUser = vi.fn();
const changePassword = vi.fn();

vi.mock('$lib/server/auth', () => ({ getAuth: () => ({ api: { updateUser, changePassword } }) }));
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));

const WRITES = [updateUser, changePassword];

const { actions } = await import('./+page.server');

type Actor = { id: string; role: string | null } | null;

const call = (name: keyof typeof actions, user: Actor, fields: Record<string, string> = {}) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	const event = {
		request: { formData: async () => data, headers: new Headers() },
		locals: { user }
	} as unknown as Parameters<NonNullable<(typeof actions)[typeof name]>>[0];
	return actions[name]!(event);
};

const END_USER: Actor = { id: 'someone', role: 'user' };
const ROLELESS: Actor = { id: 'nobody', role: null };
const OPERATOR: Actor = { id: 'staff-1', role: 'operator' };

const ACTIONS = [
	{ name: 'updateName', write: updateUser, fields: { name: 'Ada' } },
	{
		name: 'changePassword',
		write: changePassword,
		fields: { currentPassword: 'the-old-one', newPassword: 'a-long-enough-one' }
	}
] as const;

beforeEach(() => {
	vi.clearAllMocks();
});

describe.each(ACTIONS)('$name', ({ name, write, fields }) => {
	// THE PAIR. An END-USER is the actor that discriminates, and the direction is inverted from every
	// other gated page here: `user` is the role /admin exists to turn away, and this portal is where
	// it turns them away TO. A role check copied in from a sibling route would refuse all three actors
	// below and pass any refusal-only test; only admitting them proves the gate is the right one.
	it.each([
		['an end-user', END_USER],
		['an account carrying no role', ROLELESS],
		['a staff account, which gets a portal of its own too', OPERATOR]
	])('admits %s', async (_label, user) => {
		await call(name, user, fields);

		expect(write).toHaveBeenCalled();
	});

	it('refuses an anonymous caller without reaching better-auth', async () => {
		const result = await call(name, null, fields);

		expect(result).toMatchObject({ status: 401 });
		for (const other of WRITES) expect(other).not.toHaveBeenCalled();
	});

	// The isolation property, asserted STRUCTURALLY rather than by trying to target someone else:
	// both endpoints act on the session that carries the request, so there is no account id anywhere
	// in the body for a caller to supply. A future edit that threaded one through from the form —
	// which is how /admin/users/[id] legitimately works, so it is the shape someone would copy —
	// turns "signed in" into "signed in, and may act on anyone" while leaving every gate test green.
	it('sends better-auth no account id to act on', async () => {
		await call(name, END_USER, fields);

		const [{ body }] = write.mock.calls.at(-1)!;
		expect(Object.keys(body as object)).not.toContain('userId');
	});
});

describe('updateName', () => {
	// Echoed back deliberately: `locals.user` was resolved by the hook BEFORE the action ran, so the
	// same-request re-render's load still reads the old name. Without the echo the field reverts to
	// the pre-save value under a success banner.
	it('echoes the saved name back for the same-request re-render', async () => {
		const result = await call('updateName', END_USER, { name: 'Ada' });

		expect(result).toEqual({ scope: 'profile', ok: true, name: 'Ada' });
	});

	it('refuses an empty name', async () => {
		const result = await call('updateName', END_USER, { name: '  ' });

		expect(result).toMatchObject({ status: 400 });
		expect(updateUser).not.toHaveBeenCalled();
	});
});

describe('changePassword', () => {
	it('refuses a new password under eight characters before sending the old one anywhere', async () => {
		const result = await call('changePassword', END_USER, {
			currentPassword: 'the-old-one',
			newPassword: 'short'
		});

		expect(result).toMatchObject({ status: 400, data: { error: 'password_short' } });
		expect(changePassword).not.toHaveBeenCalled();
	});

	// A wrong current password comes back as the same generic code as any other rejection, so the
	// form cannot be used to test one. Only an APIError is swallowed — anything else is a fault and
	// must surface rather than be reported to the visitor as a bad password.
	it('reports a rejected current password without saying which part was wrong', async () => {
		changePassword.mockRejectedValueOnce(
			new APIError('BAD_REQUEST', { message: 'Invalid password' })
		);

		const result = await call('changePassword', END_USER, {
			currentPassword: 'wrong',
			newPassword: 'a-long-enough-one'
		});

		expect(result).toMatchObject({ status: 400, data: { error: 'invalid' } });
	});

	it('lets a genuine fault through instead of blaming the password', async () => {
		changePassword.mockRejectedValueOnce(new TypeError('database is on fire'));

		await expect(
			call('changePassword', END_USER, {
				currentPassword: 'the-old-one',
				newPassword: 'a-long-enough-one'
			})
		).rejects.toThrow('database is on fire');
	});
});
