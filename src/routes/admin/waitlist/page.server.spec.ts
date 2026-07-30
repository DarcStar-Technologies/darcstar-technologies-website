import { beforeEach, describe, expect, it, vi } from 'vitest';

// The /admin/waitlist form actions, which had no test at all before DAR-140.
//
// WHY THIS FILE EXISTS AT ALL: SvelteKit does NOT run a layout guard before a form action — only on
// the re-render afterwards — so `../+layout.server.ts` protects the PAGE and not a single one of these
// POSTs. The `isStaff` line inside each action is therefore the whole authorization boundary, and
// nothing anywhere proved it was there.
//
// That was MEASURED rather than reasoned from the docs, because the response actively hides it: with
// the gate removed, an anonymous POST at a real lead against a running preview answered `303 → /login`
// AND wrote the row (`updates_unsubscribed_by: "ANONYMOUS-PROBE"`). The redirect comes from the
// re-render, so an ungated action looks exactly like a refused one — a signed-in end-user gets the
// same shape, `303 → /account`. Nothing about the response can tell you the gate is missing.
//
// Survivable while the vocabulary was "delete", which at least fails loudly; DAR-140 adds a write that
// is silent, durable and irreversible from this page, which is what made the gap worth closing.
//
// It cannot be an e2e: /admin redirects in CI (no session cookie, no reachable DB), so
// `page.svelte.e2e.ts` can only ever assert that redirect. Mocking the request-scoped handles is the
// only place an action's body is reachable.
//
// `isStaff` and `readEnv`'s ALLOWLIST are deliberately NOT mocked — the real predicate runs, so a
// mutation to the gate fails here rather than being absorbed by a stub that agrees with it.

const unsubscribeUpdates = vi.fn();
const markWaitlistReviewed = vi.fn();
const deleteWhere = vi.fn();

vi.mock('$lib/server/db', () => ({
	getDb: () => ({ delete: () => ({ where: deleteWhere }) })
}));
// ADMIN_USER_IDS is the owner-bootstrap allowlist; empty here so the role is what decides.
vi.mock('$lib/server/env', () => ({ readEnv: () => undefined }));
vi.mock('$lib/server/waitlist-store', () => ({
	unsubscribeUpdates,
	readWaitlistTriageWindow: vi.fn()
}));
// Only `review`'s write is needed, but the module is mocked whole, so the other three are stubbed to
// keep the import graph honest rather than left undefined.
vi.mock('$lib/server/waitlist-invite', () => ({
	markWaitlistReviewed,
	findAccountByEmail: vi.fn(),
	findWaitlistInviteTarget: vi.fn(),
	markWaitlistInvited: vi.fn()
}));

/**
 * Every write an action can reach past its gate. A gate test asserts on ALL of them rather than on the
 * one that action happens to use, because "didn't delete" is vacuously true of an action that updates —
 * which is exactly the shape a per-action assertion drifts into.
 */
const WRITES = [unsubscribeUpdates, markWaitlistReviewed, deleteWhere];

const { actions } = await import('./+page.server');

type Actor = { id: string; role: string } | null;

/** The slice of a RequestEvent these actions read: a form body and `locals.user`. */
const call = (name: keyof typeof actions, user: Actor, fields: Record<string, string> = {}) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	const event = {
		request: { formData: async () => data },
		locals: { user }
	} as unknown as Parameters<NonNullable<(typeof actions)[typeof name]>>[0];
	return actions[name]!(event);
};

const OPERATOR: Actor = { id: 'staff-1', role: 'operator' };
const SIGNED_IN_USER: Actor = { id: 'someone', role: 'user' };

// The action's audit line. Silenced once for the file rather than re-spied per test, which would
// stack a new spy on every `beforeEach`; `clearAllMocks` only clears call data, not implementations.
vi.spyOn(console, 'info').mockImplementation(() => {});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('recordOptOut (DAR-140)', () => {
	it('records the withdrawal and names the address back', async () => {
		unsubscribeUpdates.mockResolvedValue({
			email: 'ada@example.com',
			updatesConfirmSentAt: null,
			updatesConfirmedAt: null,
			updatesUnsubscribedAt: new Date()
		});

		const result = await call('recordOptOut', OPERATOR, { id: 'lead-1' });

		expect(result).toEqual({ optOut: { ok: true, email: 'ada@example.com' } });
	});

	// THE POINT OF THE COLUMN. A withdrawal recorded by staff has to be distinguishable from one the
	// mailbox made itself, and the only thing carrying that distinction is the actor this action hands
	// down. The required `string | null` parameter stops it being FORGOTTEN, and cannot stop it being
	// WRONG — `null` and the lead's own id both type-check — so this asserts the signed-in operator's
	// id specifically rather than merely that three arguments were passed.
	it('passes the signed-in operator down as the recorder', async () => {
		unsubscribeUpdates.mockResolvedValue({ email: 'ada@example.com' });

		await call('recordOptOut', OPERATOR, { id: 'lead-1' });

		expect(unsubscribeUpdates).toHaveBeenCalledWith(expect.anything(), 'lead-1', 'staff-1');
	});

	// A signed-in end-user is the case that matters: they hold a valid session cookie, so `locals.user`
	// is populated and only the role keeps them out. An anonymous caller is covered too.
	it.each([
		['a signed-in end-user', SIGNED_IN_USER],
		['an anonymous caller', null]
	])('refuses %s without touching the database', async (_label, user) => {
		const result = await call('recordOptOut', user, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 403 });
		for (const write of WRITES) expect(write).not.toHaveBeenCalled();
	});

	it('refuses a submit with no lead id', async () => {
		const result = await call('recordOptOut', OPERATOR);

		expect(result).toMatchObject({ status: 400 });
		expect(unsubscribeUpdates).not.toHaveBeenCalled();
	});

	// Reported rather than swallowed, unlike `delete`'s idempotent no-op: this write cannot be undone
	// from the page, so an operator who pressed the button has to learn the row went away between
	// render and click instead of being told it worked.
	it('reports a lead that vanished between render and click', async () => {
		unsubscribeUpdates.mockResolvedValue(null);

		const result = await call('recordOptOut', OPERATOR, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 404 });
	});
});

// The three siblings that share the gate. Free to assert now that the scaffolding exists, and worth
// asserting because the gate is hand-written per action — there is no type or route rule that makes a
// new one inherit it. `invite` is left alone: its gate is identical, and reaching past it would need
// better-auth, the activation minter and Resend mocked for no additional coverage of the boundary.
describe('the staff gate on the other write actions', () => {
	it.each(['delete', 'deleteSubmission', 'review'] as const)(
		'%s refuses a signed-in end-user without touching the database',
		async (action) => {
			const result = await call(action, SIGNED_IN_USER, { id: 'lead-1' });

			expect(result).toMatchObject({ status: 403 });
			// Every write, not this action's own: `review` never deletes, so asserting only on `deleteWhere`
			// would be vacuously true of it and the row would be covered in name only.
			for (const write of WRITES) expect(write).not.toHaveBeenCalled();
		}
	);
});
