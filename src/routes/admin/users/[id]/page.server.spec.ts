import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formActions } from '$lib/server/source-scan';

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
// `rosterAdmin`, `guardTarget`, `mayEditDetails` and `isRosterAdmin` are deliberately NOT mocked. The
// real predicates run, so a mutation to a gate fails here instead of being absorbed by a stub that
// agrees with it; only `readEnv` (to set the owner allowlist) and better-auth (to observe the writes)
// are replaced.

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

// The two READS. Only `load` calls them, and it is exercised at the bottom of this file — the page's
// `detailsEditable` flag is half of DAR-230's fix, so the form it renders has to be held against the
// action that receives it. They stay out of `WRITES` below: a read is not a thing a refusal must
// avoid, and listing one there would make every refusal assertion quietly weaker.
const getUser = vi.fn(async () => ({ id: 'whoever', name: 'Ada', email: 'ada@example.com' }));
const listUserSessions = vi.fn(async () => ({ sessions: [] }));

vi.mock('$lib/server/auth', () => ({
	getAuth: () => ({
		api: {
			getUser,
			listUserSessions,
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

const { actions, load } = await import('./+page.server');

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
 * The same slice for the page `load`, which reads no form body.
 *
 * `PageServerLoad` permits a `void` return, so the result is a union this narrows by THROWING rather
 * than by optional-chaining past it: `data?.detailsEditable` would quietly assert nothing at all the
 * day the load stopped returning, which is the whole state this spec exists to notice.
 */
const loadPage = async (user: Actor, targetId: string) => {
	const data = await load({
		params: { id: targetId },
		request: { headers: new Headers() },
		locals: { user }
	} as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('load returned nothing');
	return data;
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
/** An ADMIN_USER_IDS owner carrying no role at all — admitted by the bootstrap and nothing else. */
const OWNER: Actor = { id: 'owner-1', role: null };
const TARGET = 'target-1';

/**
 * The seven actions, with the smallest form body that reaches the better-auth call — so a refusal
 * measured against `write` is a refusal and not a validation failure wearing one's coat.
 *
 * `guard` records WHICH targets the action refuses on top of the role gate, and it is a tri-state
 * rather than a flag because DAR-230 made the two halves of `guardTarget` separable:
 *
 *   'self+owner' — the five destructive actions, which refuse both.
 *   'owner'      — `updateDetails`. Email is the sign-in identity, so re-addressing an owner and then
 *                  running self-service password reset takes over an account whose id — the thing
 *                  ADMIN_USER_IDS is keyed on — never changed. Correcting your OWN address stays open.
 *   'none'       — `enable`, which only restores access.
 *
 * Every table below is derived from this column, so getting it wrong shrinks a table rather than
 * failing; it is held against the source in the first test.
 */
const ACTIONS = [
	{
		name: 'updateDetails',
		write: adminUpdateUser,
		guard: 'owner',
		fields: { name: 'Ada', email: 'ada@example.com' }
	},
	{ name: 'setRole', write: setRole, guard: 'self+owner', fields: { role: 'operator' } },
	{
		name: 'resetPassword',
		write: setUserPassword,
		guard: 'self+owner',
		fields: { newPassword: 'a-long-enough-one' }
	},
	{ name: 'forceLogout', write: revokeUserSessions, guard: 'self+owner', fields: {} },
	{ name: 'disable', write: banUser, guard: 'self+owner', fields: {} },
	{ name: 'enable', write: unbanUser, guard: 'none', fields: {} },
	{ name: 'delete', write: removeUser, guard: 'self+owner', fields: { confirm: 'on' } }
] as const;

const REFUSES_SELF = ACTIONS.filter((a) => a.guard === 'self+owner');
const REFUSES_OWNER = ACTIONS.filter((a) => a.guard !== 'none');
const ALLOWS_SELF = ACTIONS.filter((a) => a.guard !== 'self+owner');
const ALLOWS_OWNER = ACTIONS.filter((a) => a.guard === 'none');

beforeEach(() => {
	vi.clearAllMocks();
	ownerCsv = undefined;
});

// The table above is a CLAIM about the code, and everything below derives from it — so a row edited
// to match a failing test would quietly narrow a table instead of going red, which is the one failure
// mode a data-driven spec has that a hand-written one doesn't. Held against the source: which target
// guard each action actually names, read with the repo's own action parser.
//
// It pins the action SET as well, in both directions — an eighth action with no row here fails, and
// so does a row naming an action that no longer exists.
//
// `mayEditDetails` is tested FIRST because it wraps `guardTarget`: an action naming both would be
// classified by the narrower one. Nothing does today, and if one did the behavioural tables below
// would disagree with whichever answer this gave — so the precedence decides a message, not a verdict.
it('classifies each action by the target guard it names in source', () => {
	const named = Object.entries(formActions('src/routes/admin/users/[id]/+page.server.ts')).map(
		([name, body]) => [
			name,
			/\bmayEditDetails\s*\(/.test(body)
				? 'owner'
				: /\bguardTarget\s*\(/.test(body)
					? 'self+owner'
					: 'none'
		]
	);

	expect(Object.fromEntries(named)).toEqual(
		Object.fromEntries(ACTIONS.map((a) => [a.name, a.guard]))
	);
});

// Every tier has members, asserted by name. `describe.each([])` is an error in vitest rather than a
// silent pass, but "this tier lost the one action that discriminates" is not — dropping
// `updateDetails` to 'none' would empty nothing and take the owner-refusal table with it.
it('leaves every guard tier populated', () => {
	expect(REFUSES_SELF.map((a) => a.name)).toEqual([
		'setRole',
		'resetPassword',
		'forceLogout',
		'disable',
		'delete'
	]);
	expect(REFUSES_OWNER.map((a) => a.name)).toEqual([
		'updateDetails',
		'setRole',
		'resetPassword',
		'forceLogout',
		'disable',
		'delete'
	]);
	expect(ALLOWS_SELF.map((a) => a.name)).toEqual(['updateDetails', 'enable']);
	expect(ALLOWS_OWNER.map((a) => a.name)).toEqual(['enable']);
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
		ownerCsv = OWNER.id;

		await call('setRole', OWNER, TARGET, { role: 'operator' });

		expect(setRole).toHaveBeenCalled();
	});

	it('refuses the same account once it is off the allowlist', async () => {
		ownerCsv = 'someone-else';

		const result = await call('setRole', OWNER, TARGET, { role: 'operator' });

		expect(result).toMatchObject({ status: 403 });
		expect(setRole).not.toHaveBeenCalled();
	});
});

// `guardTarget` stops an admin acting on their OWN account or on an ADMIN_USER_IDS owner. It is a
// foot-gun guard rather than a hard boundary — the better-auth admin endpoints have no owner concept,
// so a promoted admin could still target an owner through the raw API — but within this page it is
// what keeps the roster from locking itself out, and it is hand-repeated across six actions.
describe.each(REFUSES_SELF)('$name against the acting admin', ({ name, fields }) => {
	it('refuses their own account', async () => {
		const result = await settle(call(name, ADMIN, ADMIN.id, fields));

		expect(result).toMatchObject({ status: 403, data: { error: 'self' } });
		for (const other of WRITES) expect(other).not.toHaveBeenCalled();
	});
});

describe.each(REFUSES_OWNER)('$name against an owner', ({ name, fields }) => {
	it('refuses an ADMIN_USER_IDS account', async () => {
		ownerCsv = `${TARGET}, someone-else`;

		const result = await settle(call(name, ADMIN, TARGET, fields));

		expect(result).toMatchObject({ status: 403, data: { error: 'owner' } });
		for (const other of WRITES) expect(other).not.toHaveBeenCalled();
	});
});

// THE POSITION, not merely the refusal. "No write happened" is already asserted above; this pins the
// guard against a check that runs LATER in the same action, so moving it down a few lines — exactly
// the edit a refactor tidying the field validation upward would make — is visible. Only three actions
// have a subsequent validation to be pinned against; the rest reach the write directly.
describe('a target guard runs before the action validates its own fields', () => {
	it.each([
		['resetPassword', 'self', 'password_short'],
		['delete', 'self', 'generic'],
		['updateDetails', 'owner', 'missing']
	] as const)('%s answers %s, not %s', async (name, blocked, later) => {
		ownerCsv = TARGET;

		const result = await settle(call(name, ADMIN, blocked === 'self' ? ADMIN.id : TARGET, {}));

		// `later` is named in the MESSAGE rather than in a second assertion ruling it out: `error` holds
		// one value, so "is `blocked`" already excludes it, and a `not.toMatchObject` beside it would
		// read as two checks while being one.
		expect(
			result,
			`${name} reached its own field validation (${later}) before refusing the target`
		).toMatchObject({ status: 403, data: { error: blocked } });
	});

	// Non-vacuous: without this, an action that refused EVERYTHING would pass the rows above. The same
	// empty body against a legal target produces the later code, which is what shows the assertion is
	// discriminating between two reachable outcomes rather than restating "it failed".
	it.each([
		['resetPassword', 'password_short'],
		['delete', 'generic'],
		['updateDetails', 'missing']
	] as const)('%s answers %s once the target is legal', async (name, later) => {
		const result = await settle(call(name, ADMIN, TARGET, {}));

		expect(result).toMatchObject({ status: 400, data: { error: later } });
	});
});

// The direction a well-meaning "harden everything" pass would break silently, which is why the two
// actions that stay open on SELF get their own table rather than being an absence elsewhere. Both are
// capabilities an admin genuinely needs: correcting your own sign-in email, and lifting a disable you
// may have applied to yourself through the raw API. Adding a guard here reads like tightening a gate
// and removes a way back.
describe.each(ALLOWS_SELF)('$name on the acting admin’s own account', ({ name, write, fields }) => {
	it('is allowed', async () => {
		await settle(call(name, ADMIN, ADMIN.id, fields));

		expect(write).toHaveBeenCalled();
	});
});

// `enable` is the one action that reaches an owner, and it is designed: it only RESTORES access, so
// it is the sole way back for an owner disabled through the raw better-auth admin API, where the
// owner concept does not exist. Guarding it would strand them.
//
// True of the ACTION and, today, false of the PAGE — the button sits inside the `manageable` block,
// which excludes an owner, so the recovery needs a hand-made POST (DAR-234). That is the mirror of
// what DAR-230 fixed one table down: there a form was offered where the POST refuses, here a POST is
// accepted where no form is offered.
describe.each(ALLOWS_OWNER)('$name on an ADMIN_USER_IDS owner', ({ name, write, fields }) => {
	it('is allowed, which is the recovery path', async () => {
		ownerCsv = TARGET;

		await settle(call(name, ADMIN, TARGET, fields));

		expect(write).toHaveBeenCalled();
	});
});

// The case that keeps DAR-230's narrowing from stranding the very people it protects, and it rests on
// an ordering rather than on a second condition: `guardTarget` answers `self` BEFORE `owner`, so an
// owner is never blocked from their own account. Combined with the bootstrap admitting them whatever
// their role, an owner can always correct their own sign-in address — which is what makes refusing
// OTHER admins that edit a narrowing of one capability rather than the loss of one.
//
// Reversing those two lines inside `guardTarget` is a plausible tidy-up and fails exactly here.
describe('an owner editing their own account', () => {
	it('is allowed, because self is answered before owner', async () => {
		ownerCsv = OWNER.id;

		await settle(call('updateDetails', OWNER, OWNER.id, { name: 'Ada', email: 'new@example.com' }));

		expect(adminUpdateUser).toHaveBeenCalled();
	});
});

// The page and the POST, held against each other (DAR-230). Hiding the form is not cosmetic: DAR-226's
// own lesson is that a control an operator can press and that silently 403s is worse than an absent
// one, so `load` derives `detailsEditable` from `mayEditDetails` — the same helper the action gates on
// — and this drives BOTH from one row rather than asserting each separately, which is what makes it a
// test of their AGREEMENT.
const RENDER_CASES = [
	{
		label: 'an unrelated account',
		actor: ADMIN,
		targetId: TARGET,
		owners: undefined,
		offered: true
	},
	{ label: 'the acting admin', actor: ADMIN, targetId: ADMIN.id, owners: undefined, offered: true },
	{ label: 'an owner', actor: ADMIN, targetId: TARGET, owners: TARGET, offered: false },
	{
		label: 'an owner’s own account',
		actor: OWNER,
		targetId: OWNER.id,
		owners: OWNER.id,
		offered: true
	}
] as const;

describe('the details form is offered exactly where the POST is accepted', () => {
	it.each(RENDER_CASES)(
		'$label → offered: $offered',
		async ({ actor, targetId, owners, offered }) => {
			ownerCsv = owners;
			const data = await loadPage(actor, targetId);

			expect(data.detailsEditable).toBe(offered);

			await settle(call('updateDetails', actor, targetId, { name: 'Ada', email: 'a@example.com' }));

			expect(adminUpdateUser).toHaveBeenCalledTimes(offered ? 1 : 0);
		}
	);

	// The card is hidden by `detailsEditable` and the explanatory note is rendered by `manageable`'s
	// else-branch, so a card can only disappear silently if those two ever disagree in that direction.
	// `manageable` excludes self as well, so it is strictly the narrower flag and this holds — but it
	// holds by arithmetic on two separately-written expressions, which is the kind of thing that stops
	// being true one edit later.
	it.each(RENDER_CASES)(
		'$label → never hides the card without the note',
		async ({ actor, targetId, owners }) => {
			ownerCsv = owners;
			const data = await loadPage(actor, targetId);

			expect(!data.detailsEditable && data.manageable).toBe(false);
		}
	);
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
