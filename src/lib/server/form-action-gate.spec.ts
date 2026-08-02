import { describe, expect, it } from 'vitest';
import { dirname } from 'node:path';
import { appSourcePaths, formActions, sourceText, splitTopLevel } from './source-scan';

// EVERY form action behind a route guard must authorize itself, and the sibling specs
// (`routes/**/page.server.spec.ts`) can only say that about the actions that exist today.
//
// THE RULE. SvelteKit does not run a layout `load` guard before a form action, only on the re-render
// afterwards. So a `+layout.server.ts` protects page LOADS and nothing else, and each action's own
// first few lines are the entire authorization boundary. DAR-140 measured what a missing one looks
// like from outside: an anonymous POST at a real lead answered `303 → /login` AND wrote the row,
// because the redirect comes from the re-render. Refused and ungated are the same response.
//
// WHY A SCAN ON TOP OF THE BEHAVIOURAL SPECS. Those pin 18 actions. Nothing makes the NINETEENTH
// inherit anything — the gate is hand-written per action, there is no type that carries it, and the
// natural way to add one is to copy a neighbour and edit the middle. This is DAR-102's shape: a rule
// over a DERIVED surface, so a new action (or a whole new guarded route) fails closed rather than
// arriving uncovered.
//
// WHY THE SURFACE IS DERIVED FROM THE LAYOUT GUARDS rather than a `['admin', 'account']` list: that
// list is a SCAN list, whose polarity is backwards — deleting an entry makes the scan blind, and
// DAR-99 measured exactly that at 7/7 green. A guarded subtree announces itself by having a
// `+layout.server.ts` that redirects, so adding a third one widens this rule automatically.

/** A route directory is protected when its layout `load` bounces someone. */
const PROTECTED_ROOTS = appSourcePaths()
	.filter((path) => path.endsWith('/+layout.server.ts'))
	.filter((path) => /\bredirect\s*\(/.test(sourceText(path)))
	.map(dirname);

const isPageServer = (path: string) => path.endsWith('/+page.server.ts');
const hasActions = (path: string) => Object.keys(formActions(path)).length > 0;

const GUARDED_PAGE_SERVERS = appSourcePaths().filter(
	(path) => isPageServer(path) && PROTECTED_ROOTS.some((root) => path.startsWith(`${root}/`))
);

/**
 * ...of which only some POST anything. A guarded page may legitimately be read-only — `/admin/audit`
 * is — so the rule is about the files with actions, and the two sets are kept apart so that "this
 * page has no actions" can never be mistaken for "the parser found none".
 */
const GUARDED_ACTION_FILES = GUARDED_PAGE_SERVERS.filter(hasActions);

/**
 * The predicates that decide whether this caller may act. Small on purpose — a new one is a new
 * answer to "who may do this", which is worth a deliberate edit here rather than a pattern loose
 * enough to accept anything.
 */
const GATES = [/\bisStaff\s*\(/, /\bisRosterAdmin\s*\(/, /\brosterAdmin\s*\(/, /\blocals\.user\b/];

/**
 * ...and the refusal it produces. Required TOGETHER with a gate, because neither half is sufficient:
 * `locals.user` also appears when an action merely reads the actor's id to attribute a write, and a
 * `fail(403)` also appears for reasons that are not about the caller. A `redirect` is deliberately
 * not accepted — a redirect out of a form action is what DAR-140's ungated write looked like.
 */
const REFUSAL = /\b(?:fail|error)\s*\(\s*40[13]\b/;

/**
 * The region an action gets to decide in: everything before its first `await`.
 *
 * This is the property, not a proxy for it — an action must answer "may you?" before it does
 * anything at all, and these files already state the rule in prose for a second reason (the
 * request-scoped `readEnv`/`getDb` handles read back empty once the async context is left). Scoping
 * the search here is also what stops a mid-body `locals.user!.id` attribution read from counting as
 * a gate.
 */
const beforeFirstAwait = (action: string) => action.split(/\bawait\b/)[0];

const gateOf = (action: string) => {
	const head = beforeFirstAwait(action);
	return GATES.some((gate) => gate.test(head)) && REFUSAL.test(head);
};

describe('the surface this rule covers', () => {
	// A FLOOR, not the set: a hand-written list would go blind the moment someone deleted an entry,
	// whereas this fails loudly if a derivation ever stops matching. The opposite polarity, and the
	// reason `PROTECTED_ROOTS` is computed above rather than typed out.
	it('finds every route subtree that a layout guard protects', () => {
		expect(PROTECTED_ROOTS.sort()).toEqual([
			'src/routes/account',
			'src/routes/admin',
			'src/routes/admin/users'
		]);
	});

	// The other side of that boundary, and the thing that would break loudest if the `redirect` filter
	// stopped discriminating: the root layout does not guard, so the public actions are out of scope.
	// They are unauthenticated BY DESIGN — signing in is not something you can already be signed in
	// for — so a rule that reached them would be wrong rather than merely noisy, and would get
	// loosened until it caught nothing (DAR-152).
	it('leaves the public form actions alone', () => {
		const publicActions = appSourcePaths().filter(
			(path) => isPageServer(path) && hasActions(path) && !GUARDED_PAGE_SERVERS.includes(path)
		);

		expect(publicActions.sort()).toEqual([
			'src/routes/forgot-password/+page.server.ts',
			'src/routes/login/+page.server.ts',
			'src/routes/reset-password/+page.server.ts',
			'src/routes/updates/confirm/+page.server.ts',
			'src/routes/updates/unsubscribe/+page.server.ts'
		]);
	});

	// EXACT, not a floor, and the difference is deliberate: a sixth guarded page that POSTs is a new
	// authorization boundary, and a red test naming it is how the person adding it meets this rule.
	// Both edit directions report themselves.
	it('holds every guarded page server that POSTs', () => {
		expect(GUARDED_ACTION_FILES.sort()).toEqual([
			'src/routes/account/+page.server.ts',
			'src/routes/admin/+page.server.ts',
			'src/routes/admin/users/+page.server.ts',
			'src/routes/admin/users/[id]/+page.server.ts',
			'src/routes/admin/waitlist/+page.server.ts'
		]);
	});

	// REACH CONTROL, and the one that matters. "No violations" and "the parser found nothing to check"
	// print identically (DAR-152), and the specific way `formActions` can under-report is by having a
	// comma swallowed inside a string or bracket — which merges two actions into one segment that
	// still parses, so nothing throws. A second instrument with no shared machinery (a line-anchored
	// regex against the raw text, versus a bracket-depth walker over the comment-stripped text)
	// disagreeing is what makes that visible.
	it('agrees with an independent count of the actions in each file', () => {
		for (const path of GUARDED_ACTION_FILES) {
			const declared = [...sourceText(path).matchAll(/^\t(\w+):\s*(?:async\s*)?\(/gm)].map(
				([, name]) => name
			);

			expect(Object.keys(formActions(path)).sort(), path).toEqual(declared.sort());
		}
	});
});

describe('every form action behind a route guard authorizes itself', () => {
	// Per ACTION, never per file. DAR-102 measured the difference: a step appended INSIDE an
	// already-passing file inherited that file's pass and was invisible. Adding a ninth action to
	// `waitlist/+page.server.ts` is exactly that shape.
	const everyAction = GUARDED_ACTION_FILES.flatMap((path) =>
		Object.entries(formActions(path)).map(([name, source]) => ({ path, name, source }))
	);

	it.each(everyAction)('$path → $name', ({ source }) => {
		expect(gateOf(source)).toBe(true);
	});

	// Without this, the row above passes just as happily against a `gateOf` that answers `true` for
	// anything — the whole file's assertions are otherwise "nothing was wrong".
	it('covers all eighteen of them', () => {
		expect(everyAction.length).toBeGreaterThanOrEqual(18);
	});
});

// The detector's own tests. Every assertion above is a negative ("nothing failed"), which is
// satisfied by a predicate that cannot fail — so the two halves of the rule are pinned here, each
// against an action that carries only the other one.
describe('the gate predicate', () => {
	const gated = `delete: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) return fail(403, { error: 'forbidden' });
		const data = await request.formData();
		return { ok: true };
	}`;

	it('accepts an action that refuses before it does anything', () => {
		expect(gateOf(gated)).toBe(true);
	});

	it('rejects one with no gate at all', () => {
		expect(gateOf(gated.replace(/if \(![\s\S]*?\n/, ''))).toBe(false);
	});

	it('rejects a predicate with no refusal behind it', () => {
		expect(gateOf(gated.replace("return fail(403, { error: 'forbidden' })", 'noop()'))).toBe(false);
	});

	it('rejects a refusal with no predicate in front of it', () => {
		expect(gateOf(gated.replace(/isStaff\([^)]*\)/, 'somethingElse()'))).toBe(false);
	});

	// The reason the search is scoped to the head rather than the whole body: reading the actor's id
	// to attribute a write is not deciding whether they may make it, and it names `locals.user`.
	it('rejects a gate token that only appears after the first await', () => {
		const attributionOnly = `review: async ({ request, locals }) => {
			const data = await request.formData();
			if (!data.get('id')) return fail(403, { error: 'missing' });
			await markReviewed(data.get('id'), locals.user!.id);
		}`;

		expect(gateOf(attributionOnly)).toBe(false);
	});
});

// `splitTopLevel` is what decides where one action stops and the next begins, so the ways it can be
// wrong are the ways this whole file can report clean about an action it never read.
describe('splitting an object literal into its properties', () => {
	it('splits on the commas between properties', () => {
		expect(splitTopLevel('a: 1, b: 2').map((s) => s.trim())).toEqual(['a: 1', 'b: 2']);
	});

	it('ignores commas nested in brackets, braces and parens', () => {
		expect(splitTopLevel('a: f({ x, y }, [1, 2]), b: 2').map((s) => s.trim())).toEqual([
			'a: f({ x, y }, [1, 2])',
			'b: 2'
		]);
	});

	// The under-reporting case: a swallowed comma merges two properties into one segment.
	it('ignores commas inside strings and template literals', () => {
		expect(splitTopLevel('a: "x, y", b: `p, ${q}`, c: 3').map((s) => s.trim())).toEqual([
			'a: "x, y"',
			'b: `p, ${q}`',
			'c: 3'
		]);
	});

	it('does not mistake an escaped quote for the end of a string', () => {
		expect(splitTopLevel("a: 'it\\'s, fine', b: 2").map((s) => s.trim())).toEqual([
			"a: 'it\\'s, fine'",
			'b: 2'
		]);
	});

	// Stopping here is what lets `formActions` hand it everything after the opening brace. Reading to
	// the end of the file instead works today only because `actions` happens to be the last export in
	// all five files, which nothing holds in place.
	it('stops at the closing brace of the object it was given', () => {
		expect(splitTopLevel('a: 1 } , after: 2').map((s) => s.trim())).toEqual(['a: 1']);
	});
});

describe('reading the actions out of a real page server', () => {
	// A positive case, because everything else here asks whether something is ABSENT. If `formActions`
	// silently returned `{}` for every file, only this and the floor above would notice.
	it('names the seven the roster detail page exports', () => {
		const actions = formActions('src/routes/admin/users/[id]/+page.server.ts');

		expect(Object.keys(actions).sort()).toEqual([
			'delete',
			'disable',
			'enable',
			'forceLogout',
			'resetPassword',
			'setRole',
			'updateDetails'
		]);
		expect(actions.setRole).toContain('auth.api.setRole');
	});

	it('returns nothing for a module that exports no actions', () => {
		expect(formActions('src/routes/admin/+layout.server.ts')).toEqual({});
	});
});
