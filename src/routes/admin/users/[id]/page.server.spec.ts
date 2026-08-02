import { beforeEach, describe, expect, it, vi } from 'vitest';

// The seven /admin/users/[id] form actions (DAR-226). Role change, password reset, force-logout,
// disable, enable, delete and detail edit — every destructive capability the roster has, and none of
// them had a test.
//
// WHY A SPEC AND NOT A REVIEW: SvelteKit does NOT run a layout guard before a form action, only on
// the re-render afterwards, so `../+layout.server.ts` and `../../+layout.server.ts` protect the PAGE
// and not one of these POSTs. The `rosterAdmin(locals)` line inside each action is the entire
// authorization boundary. DAR-140 measured what a missing one looks like from outside: an anonymous
// POST answered `303 → /login` AND wrote the row, because the redirect comes from the re-render. A
// gate that isn't there is indistinguishable from one that is, so nothing but a test can see it.
//
// It cannot be an e2e — /admin redirects in CI (no session cookie, no reachable DB), so
// `../page.svelte.e2e.ts` can only ever watch that redirect. Mocking the request-scoped handles is
// the only place an action body is reachable at all.
//
// `rosterAdmin`, `guardTarget` and `isRosterAdmin` are deliberately NOT mocked. The real predicates
// run, so a mutation to a gate fails here instead of being absorbed by a stub that agrees with it;
// only `readEnv` (to set the owner allowlist) and better-auth (to observe the writes) are replaced.

/** ADMIN_USER_IDS, per test. Also the owner allowlist `guardTarget` reads — one env var, two jobs. */
let ownerCsv: string | undefined;

vi.mock('$lib/server/env', () => ({
	readEnv: (key: string) => (key === 'ADMIN_USER_IDS' ? ownerCsv : undefined)
}));

const adminUpdateUser = vi.fn();
const setRole = vi.fn();
const setUserPassword = vi.fn();
const revokeUserSessions = vi.fn();
const banUser = vi.fn();
const unbanUser = vi.fn();
const removeUser = vi.fn();

vi.mock('$lib/server/auth', () => ({
	getAuth: () => ({
		api: {
			adminUpdateUser,
			setRole,
			setUserPassword,
			revokeUserSessions,
			banUser,
			unbanUser,
			removeUser
		}
	})
}));

/**
 * Every mutating better-auth call these actions can reach past their gates.
 *
 * A refusal asserts on ALL of them rather than on the one that action happens to use, because
 * "didn't ban anyone" is vacuously true of `setRole` — which is precisely the shape a per-action
 * assertion drifts into, leaving the row covered in name only (DAR-140).
 *
 * The two READS the page's `load` makes (`getUser`, `listUserSessions`) are deliberately absent: no
 * action calls them, so listing them here would be a claim about code that doesn't exist.
 */
const WRITES = [
	adminUpdateUser,
	setRole,
	setUserPassword,
	revokeUserSessions,
	banUser,
	unbanUser,
	removeUser
];

const { actions } = await import('./+page.server');

type Actor = { id: string; role: string | null } | null;

/** The slice of a RequestEvent these actions read: the target id, a form body, and `locals.user`. */
const call = (
	name: keyof typeof actions,
	user: Actor,
	targetId: string,
	fields: Record<string, string> = {}
) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	const event = {
		params: { id: targetId },
		request: { formData: async () => data, headers: new Headers() },
		locals: { user }
	} as unknown as Parameters<NonNullable<(typeof actions)[typeof name]>>[0];
	return actions[name]!(event);
};

/**
 * `delete` signals success by THROWING a redirect while the other six return; this makes the table
 * uniform. Safe to swallow because every caller then asserts on a WRITE having happened — a real
 * error would leave the spy untouched and fail the test rather than pass it quietly.
 */
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
const TARGET = 'target-1';

/**
 * The seven actions, with the smallest form body that reaches the better-auth call — so a refusal
 * measured against `write` is a refusal and not a validation failure wearing one's coat.
 *
 * `guarded` records whether the action ALSO carries `guardTarget` (self/owner). Five do; the two that
 * don't are a design decision with a cost, asserted in both directions below.
 */
const ACTIONS = [
	{
		name: 'updateDetails',
		write: adminUpdateUser,
		guarded: false,
		fields: { name: 'Ada', email: 'ada@example.com' }
	},
	{ name: 'setRole', write: setRole, guarded: true, fields: { role: 'operator' } },
	{
		name: 'resetPassword',
		write: setUserPassword,
		guarded: true,
		fields: { newPassword: 'a-long-enough-one' }
	},
	{ name: 'forceLogout', write: revokeUserSessions, guarded: true, fields: {} },
	{ name: 'disable', write: banUser, guarded: true, fields: {} },
	{ name: 'enable', write: unbanUser, guarded: false, fields: {} },
	{ name: 'delete', write: removeUser, guarded: true, fields: { confirm: 'on' } }
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	ownerCsv = undefined;
});

describe.each(ACTIONS)('$name', ({ name, write, fields }) => {
	it('admits a roster admin', async () => {
		await settle(call(name, ADMIN, TARGET, fields));

		expect(write).toHaveBeenCalled();
	});

	// The PAIR, which is the whole reason the test above exists alongside this one: asserting only the
	// refusal passes against a build that had locked everyone out, and asserting only the admission
	// passes against a build with no gate at all.
	//
	// An OPERATOR is the actor that discriminates. They hold a real session and reach /admin, so only
	// the roster-admin narrowing keeps them out — swapping `rosterAdmin` for `isStaff` (a one-word
	// edit, and the wrong predicate is the one the sibling /admin page legitimately uses) leaves an
	// end-user and an anonymous caller refused by either. This row is what goes red.
	it.each([
		['an operator', OPERATOR],
		['a signed-in end-user', SIGNED_IN_USER],
		['an anonymous caller', null]
	])('refuses %s without reaching better-auth', async (_label, user) => {
		const result = await settle(call(name, user, TARGET, fields));

		expect(result).toMatchObject({ status: 403 });
		for (const other of WRITES) expect(other).not.toHaveBeenCalled();
	});
});

// ADMIN_USER_IDS overrides the role check so an allowlisted owner can never be locked out by a role
// misconfiguration — the load-bearing half of the bootstrap (`isRosterAdmin`), and the reason these
// actions call `rosterAdmin` rather than testing `role === 'admin'` themselves. A role-less account
// is the case that proves it: nothing but the allowlist can admit them.
describe('the ADMIN_USER_IDS owner bootstrap', () => {
	it('admits an allowlisted account carrying no role at all', async () => {
		ownerCsv = 'ghost-1';

		await call('setRole', { id: 'ghost-1', role: null }, TARGET, { role: 'operator' });

		expect(setRole).toHaveBeenCalled();
	});

	it('refuses the same account once it is off the allowlist', async () => {
		ownerCsv = 'someone-else';

		const result = await call('setRole', { id: 'ghost-1', role: null }, TARGET, {
			role: 'operator'
		});

		expect(result).toMatchObject({ status: 403 });
		expect(setRole).not.toHaveBeenCalled();
	});
});

// `guardTarget` stops an admin acting on their OWN account or on an ADMIN_USER_IDS owner. It is a
// foot-gun guard rather than a hard boundary — the better-auth admin endpoints have no owner concept,
// so a promoted admin could still target an owner through the raw API — but within this page it is
// what keeps the roster from locking itself out, and it is hand-repeated across five actions.
const GUARDED = ACTIONS.filter((a) => a.guarded);
const UNGUARDED = ACTIONS.filter((a) => !a.guarded);

describe.each(GUARDED)('$name against a protected target', ({ name, fields }) => {
	it('refuses the acting admin their own account', async () => {
		const result = await settle(call(name, ADMIN, ADMIN.id, fields));

		expect(result).toMatchObject({ status: 403, data: { error: 'self' } });
		for (const other of WRITES) expect(other).not.toHaveBeenCalled();
	});

	it('refuses an ADMIN_USER_IDS owner', async () => {
		ownerCsv = `${TARGET}, someone-else`;

		const result = await settle(call(name, ADMIN, TARGET, fields));

		expect(result).toMatchObject({ status: 403, data: { error: 'owner' } });
		for (const other of WRITES) expect(other).not.toHaveBeenCalled();
	});
});

// THE POSITION, not merely the refusal. "No write happened" is already asserted above; this pins the
// guard against a check that runs LATER in the same action, so moving it down a few lines — exactly
// the edit a refactor tidying the field validation upward would make — is visible. Only two actions
// have a subsequent validation to be pinned against; the rest reach the write directly.
describe('guardTarget runs before the action validates its own fields', () => {
	it.each([
		['resetPassword', 'password_short', {}],
		['delete', 'generic', {}]
	] as const)('%s answers self, not %s', async (name, _later, fields) => {
		const result = await settle(call(name, ADMIN, ADMIN.id, fields));

		expect(result).toMatchObject({ status: 403, data: { error: 'self' } });
	});

	// Non-vacuous: without this, an action that refused EVERYTHING would pass the row above. The same
	// empty body against a legal target produces the later code, which is what shows the assertion is
	// discriminating between two reachable outcomes rather than restating "it failed".
	it.each([
		['resetPassword', 'password_short'],
		['delete', 'generic']
	] as const)('%s answers %s once the target is legal', async (name, later) => {
		const result = await settle(call(name, ADMIN, TARGET, {}));

		expect(result).toMatchObject({ status: 400, data: { error: later } });
	});
});

// The other direction, and the one a well-meaning "harden everything" pass would break silently.
// Both omissions are deliberate and both are capabilities:
//
//   updateDetails — email is the sign-in identity, so an admin has to be able to correct their own.
//   enable        — it only RESTORES access, and it is the sole way back for an owner who was
//                   disabled through the raw better-auth API (where the owner concept doesn't exist).
//
// Adding `guardTarget` to either reads like tightening a gate and actually removes a recovery path.
describe.each(UNGUARDED)(
	'$name deliberately skips the self/owner guard',
	({ name, write, fields }) => {
		it('acts on the admin’s own account', async () => {
			await settle(call(name, ADMIN, ADMIN.id, fields));

			expect(write).toHaveBeenCalled();
		});

		it('acts on an ADMIN_USER_IDS owner', async () => {
			ownerCsv = TARGET;

			await settle(call(name, ADMIN, TARGET, fields));

			expect(write).toHaveBeenCalled();
		});
	}
);

// The one action whose success is a redirect rather than a returned result. Asserted separately so
// the table above can stay uniform, and worth asserting because the destination is where an operator
// lands after destroying the very row the detail page was rendering.
describe('delete', () => {
	it('sends the operator back to the roster once the account is gone', async () => {
		const thrown = await settle(call('delete', ADMIN, TARGET, { confirm: 'on' }));

		expect(removeUser).toHaveBeenCalled();
		expect(thrown).toMatchObject({ status: 303, location: '/admin/users' });
	});

	it('refuses without the confirmation checkbox', async () => {
		const result = await settle(call('delete', ADMIN, TARGET, {}));

		expect(result).toMatchObject({ status: 400 });
		expect(removeUser).not.toHaveBeenCalled();
	});
});
