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
const recordDoNotContact = vi.fn();
const liftDoNotContact = vi.fn();
const markWaitlistReviewed = vi.fn();
const findAccountByEmail = vi.fn();
const findWaitlistInviteTarget = vi.fn();
const deleteWhere = vi.fn();

vi.mock('$lib/server/db', () => ({
	getDb: () => ({ delete: () => ({ where: deleteWhere }) })
}));
// ADMIN_USER_IDS is the owner-bootstrap allowlist; empty here so the role is what decides.
vi.mock('$lib/server/env', () => ({ readEnv: () => undefined }));
vi.mock('$lib/server/waitlist-store', () => ({
	unsubscribeUpdates,
	recordDoNotContact,
	liftDoNotContact,
	readWaitlistTriageWindow: vi.fn()
}));
// Only `review`'s write is needed, but the module is mocked whole, so the other three are stubbed to
// keep the import graph honest rather than left undefined.
vi.mock('$lib/server/waitlist-invite', () => ({
	markWaitlistReviewed,
	findAccountByEmail,
	findWaitlistInviteTarget,
	markWaitlistInvited: vi.fn()
}));
// `invite` resolves the auth instance before its first await, so reaching its body needs this stubbed
// even for a path that never calls it. Nothing beyond the do-not-contact refusal below is exercised
// here — that check runs before anything touches better-auth, which is the property under test.
vi.mock('$lib/server/auth', () => ({ getAuth: () => ({ api: { createUser: vi.fn() } }) }));

/**
 * Every write an action can reach past its gate. A gate test asserts on ALL of them rather than on the
 * one that action happens to use, because "didn't delete" is vacuously true of an action that updates —
 * which is exactly the shape a per-action assertion drifts into.
 */
const WRITES = [
	unsubscribeUpdates,
	recordDoNotContact,
	liftDoNotContact,
	markWaitlistReviewed,
	deleteWhere
];

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
const ADMIN: Actor = { id: 'boss-1', role: 'admin' };
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

describe('recordDoNotContact (DAR-191)', () => {
	it('records the request and names the address back', async () => {
		recordDoNotContact.mockResolvedValue({ email: 'ada@example.com', doNotContactAt: new Date() });

		const result = await call('recordDoNotContact', OPERATOR, { id: 'lead-1' });

		expect(result).toEqual({ doNotContact: { ok: true, email: 'ada@example.com' } });
	});

	// `do_not_contact_by` is cleared outright by a lift, so this actor is not merely an audit nicety —
	// it and the log line are the only record of who acted. Asserted as the operator's id specifically,
	// since the required `string | null` parameter can stop it being forgotten but not being wrong.
	it('passes the signed-in operator down as the recorder', async () => {
		recordDoNotContact.mockResolvedValue({ email: 'ada@example.com' });

		await call('recordDoNotContact', OPERATOR, { id: 'lead-1' });

		expect(recordDoNotContact).toHaveBeenCalledWith(expect.anything(), 'lead-1', 'staff-1');
	});

	it.each([
		['a signed-in end-user', SIGNED_IN_USER],
		['an anonymous caller', null]
	])('refuses %s without touching the database', async (_label, user) => {
		const result = await call('recordDoNotContact', user, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 403 });
		for (const write of WRITES) expect(write).not.toHaveBeenCalled();
	});

	it('refuses a submit with no lead id', async () => {
		const result = await call('recordDoNotContact', OPERATOR);

		expect(result).toMatchObject({ status: 400 });
		expect(recordDoNotContact).not.toHaveBeenCalled();
	});

	it('reports a lead that vanished between render and click', async () => {
		recordDoNotContact.mockResolvedValue(null);

		const result = await call('recordDoNotContact', OPERATOR, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 404 });
	});
});

describe('liftDoNotContact (DAR-191)', () => {
	// THE ASSERTION THIS FILE EXISTS FOR, and the only one that can tell `isRosterAdmin` from `isStaff`:
	// every other gate test here uses an end-user or an anonymous caller, both of whom fail either
	// predicate, so swapping the gate would leave them all green. An operator passes `isStaff` and fails
	// `isRosterAdmin`, which is precisely the asymmetry the design turns on — recording somebody's
	// request is ordinary staff work, un-recording it is not, and a control an operator could press
	// would sit one click from the Invite button it suppresses.
	//
	// The pair matters as much as the refusal: the same actor must be ALLOWED to record. Asserting only
	// the refusal would pass against a build that had locked an operator out of both.
	it('refuses an operator who may record one, and admits an admin', async () => {
		recordDoNotContact.mockResolvedValue({ email: 'ada@example.com' });
		liftDoNotContact.mockResolvedValue({ email: 'ada@example.com' });

		expect(await call('recordDoNotContact', OPERATOR, { id: 'lead-1' })).toMatchObject({
			doNotContact: { ok: true }
		});
		expect(await call('liftDoNotContact', OPERATOR, { id: 'lead-1' })).toMatchObject({
			status: 403
		});
		expect(liftDoNotContact).not.toHaveBeenCalled();

		expect(await call('liftDoNotContact', ADMIN, { id: 'lead-1' })).toMatchObject({
			doNotContact: { ok: true, lifted: true }
		});
	});

	it.each([
		['a signed-in end-user', SIGNED_IN_USER],
		['an anonymous caller', null]
	])('refuses %s without touching the database', async (_label, user) => {
		const result = await call('liftDoNotContact', user, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 403 });
		for (const write of WRITES) expect(write).not.toHaveBeenCalled();
	});

	it('refuses a submit with no lead id', async () => {
		const result = await call('liftDoNotContact', ADMIN);

		expect(result).toMatchObject({ status: 400 });
		expect(liftDoNotContact).not.toHaveBeenCalled();
	});

	it('reports a lead that vanished between render and click', async () => {
		liftDoNotContact.mockResolvedValue(null);

		const result = await call('liftDoNotContact', ADMIN, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 404 });
	});
});

// The invite's own refusal (DAR-191). Reachable here — unlike the rest of `invite`, which needs
// better-auth, the activation minter and Resend — precisely BECAUSE of the property being asserted:
// the check runs before any of them.
describe('invite against a do-not-contact lead', () => {
	it('refuses before it looks up, creates or mints anything', async () => {
		findWaitlistInviteTarget.mockResolvedValue({
			email: 'ada@example.com',
			name: 'Ada',
			doNotContactAt: new Date('2026-07-30T12:00:00Z')
		});

		const result = await call('invite', OPERATOR, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 400, data: { invite: { error: 'do_not_contact' } } });
		// THE POSITION, not just the refusal. Everything destructive in this action happens after the
		// account lookup, so "the lookup was never reached" is the cheapest proof that a refused invite
		// leaves no account, no activation token and no mail — and it is what goes red if the check is
		// moved down a few lines, which is exactly the edit a later refactor would make.
		expect(findAccountByEmail).not.toHaveBeenCalled();
	});

	// Non-vacuous: without this, a build that refused EVERY invite would pass the test above. The
	// account is a STAFF one so the action stops at the very next refusal — which keeps the assertion
	// positive (a specific, different error code) and keeps the test out of better-auth, rather than
	// asserting "not do_not_contact" while the run walks on into an activation mint that cannot work.
	it('proceeds past that check for an un-flagged lead', async () => {
		findWaitlistInviteTarget.mockResolvedValue({
			email: 'ada@example.com',
			name: 'Ada',
			doNotContactAt: null
		});
		findAccountByEmail.mockResolvedValue({ id: 'u1', role: 'admin', isStaff: true, banned: false });

		const result = await call('invite', OPERATOR, { id: 'lead-1' });

		expect(result).toMatchObject({ status: 400, data: { invite: { error: 'staff_account' } } });
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
