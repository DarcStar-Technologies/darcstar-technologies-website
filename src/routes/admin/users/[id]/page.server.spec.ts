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

// The SELF case for the two actions that carry no `guardTarget`, and the direction a well-meaning
// "harden everything" pass would break silently. Both are capabilities an admin genuinely needs:
// correcting your own sign-in email, and lifting a disable you may have applied to yourself through
// the raw API. Adding the guard here reads like tightening a gate and removes a way back.
describe.each(UNGUARDED)('$name on the acting admin’s own account', ({ name, write, fields }) => {
	it('is allowed', async () => {
		await settle(call(name, ADMIN, ADMIN.id, fields));

		expect(write).toHaveBeenCalled();
	});
});

// The OWNER case is NOT one claim but two, which is why it is not folded into the table above — and
// separating them is what showed that only one of them is designed.
//
// `enable` is: it only RESTORES access, so it is the sole way back for an owner disabled through the
// raw better-auth admin API, where the owner concept does not exist. Guarding it would strand them.
describe('enable reaches an ADMIN_USER_IDS owner, which is the recovery path', () => {
	it('lifts a disable on an owner', async () => {
		ownerCsv = TARGET;

		await settle(call('enable', ADMIN, TARGET, {}));

		expect(unbanUser).toHaveBeenCalled();
	});
});

// `updateDetails` is not, and this row records CURRENT BEHAVIOUR rather than endorsing it (DAR-230).
// Its code comment calls the action "non-destructive", and that word is carrying the whole argument:
// email is the sign-in identity, so re-addressing an owner and then using self-service password reset
// takes over an account whose id stays in ADMIN_USER_IDS — defeating the one guarantee the owner tier
// exists to give, that an admin cannot lock an owner out. The other five destructive actions all
// carry the guard; this is the one whose risk does not announce itself, which is what a foot-gun
// guard is for.
//
// Left as-is here because DAR-226 is about testing the gates, not changing them, and because
// narrowing it is a decision about the owner tier rather than a bug fix. When DAR-230 lands this
// test goes red BY DESIGN, and that is the point of writing it down.
describe('updateDetails reaches an ADMIN_USER_IDS owner (DAR-230)', () => {
	it('re-addresses an owner today, and should not once DAR-230 is decided', async () => {
		ownerCsv = TARGET;

		await settle(call('updateDetails', ADMIN, TARGET, { name: 'Ada', email: 'new@example.com' }));

		expect(adminUpdateUser).toHaveBeenCalled();
	});
});

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
