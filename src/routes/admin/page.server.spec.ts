import { beforeEach, describe, expect, it, vi } from 'vitest';

// The /admin submissions view's one form action (DAR-226): delete a contact message.
//
// SvelteKit does NOT run the layout guard before a form action, only on the re-render, so the
// `isStaff` line inside `delete` is the whole authorization boundary — see the header of
// `waitlist/page.server.spec.ts` for what DAR-140 measured a missing one to look like from outside
// (`303 → /login`, and the write lands anyway).
//
// `isStaff` itself is deliberately NOT mocked: the real predicate runs, so a mutation to the gate
// fails here rather than being absorbed by a stub that agrees with it.

vi.mock('$lib/server/env', () => ({ readEnv: () => undefined }));

const deleteWhere = vi.fn();
vi.mock('$lib/server/db', () => ({ getDb: () => ({ delete: () => ({ where: deleteWhere }) }) }));

const { actions } = await import('./+page.server');

type Actor = { id: string; role: string | null } | null;

const call = (user: Actor, fields: Record<string, string> = {}) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	const event = {
		request: { formData: async () => data },
		locals: { user }
	} as unknown as Parameters<NonNullable<(typeof actions)['delete']>>[0];
	return actions.delete!(event);
};

const ADMIN: Actor = { id: 'boss-1', role: 'admin' };
const OPERATOR: Actor = { id: 'staff-1', role: 'operator' };
const SIGNED_IN_USER: Actor = { id: 'someone', role: 'user' };

beforeEach(() => {
	vi.clearAllMocks();
});

describe('delete', () => {
	// THE PAIR, and here it runs the opposite way from the roster pages: this action is STAFF work,
	// not admin work, so an operator must be admitted. Message triage is the whole operator role
	// (#95), and tightening this to `isRosterAdmin` — the predicate the sibling /admin/users actions
	// correctly use, one identifier away — would leave operators signed in, on a page listing every
	// message, with a delete button that silently 403s. This row is what goes red.
	it.each([
		['an admin', ADMIN],
		['an operator', OPERATOR]
	])('admits %s', async (_label, user) => {
		const result = await call(user, { id: 'sub-1' });

		expect(result).toEqual({ ok: true });
		expect(deleteWhere).toHaveBeenCalled();
	});

	// The other half. A signed-in end-user is the case that matters — they hold a valid session, so
	// `locals.user` is populated and only the role keeps them out.
	it.each([
		['a signed-in end-user', SIGNED_IN_USER],
		['an anonymous caller', null]
	])('refuses %s without touching the database', async (_label, user) => {
		const result = await call(user, { id: 'sub-1' });

		expect(result).toMatchObject({ status: 403 });
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it('refuses a submit with no submission id', async () => {
		const result = await call(OPERATOR);

		expect(result).toMatchObject({ status: 400 });
		expect(deleteWhere).not.toHaveBeenCalled();
	});
});
