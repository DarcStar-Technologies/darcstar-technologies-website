import { describe, expect, test } from 'vitest';
import * as signupPage from './signup/+page.server';
import { actions as loginActions } from './login/+page.server';
import { actions as forgotActions } from './forgot-password/+page.server';
import { actions as resetActions } from './reset-password/+page.server';

// Regression guard (#119/#121/#122). SvelteKit's `check_named_default_separate` 500s EVERY POST to a
// page whose `actions` object MIXES a `default` action with named ones — not just a POST to the
// default. #119 (signup) and #121 (login) each added a `resend` NAMED action beside the original
// `default`, silently breaking both auth form submits in production (the hermetic unit tests call
// `auth.api.*` directly and the e2e only GETs, so neither exercised a real action POST). #122 fixed
// it by making those pages named-only.
//
// The load-bearing invariant is "no page mixes default + named". A page with ONLY `default`
// (forgot/reset-password) or ONLY named actions (signup/login) is fine; the mix is the trap.
function assertNoMixedActions(actions: Record<string, unknown>) {
	const keys = Object.keys(actions);
	const hasDefault = keys.includes('default');
	const hasNamed = keys.some((k) => k !== 'default');
	expect(hasDefault && hasNamed).toBe(false);
}

describe('auth pages never mix `default` + named actions — #119/#121/#122 regression', () => {
	// DAR-67 emptied /signup: registration is invite-only, so the page is a notice with nothing to
	// submit and exports no `actions` at all. Asserted rather than deleted, because "it has no actions"
	// is exactly the state a future re-opening would end: whoever adds a form back has to come here and
	// decide default-vs-named deliberately, which is the whole point of this guard.
	test('/signup exports no actions at all', () => {
		expect('actions' in signupPage).toBe(false);
	});

	// login is named-only (a `resend` beside the sign-in action), so its forms post to `?/<name>`
	// (LoginForm.svelte).
	test('/login is named-only', () => {
		assertNoMixedActions(loginActions);
		expect(Object.keys(loginActions).sort()).toEqual(['resend', 'signin']);
	});

	// forgot/reset-password have a single action, so `default` is correct — but if a named action is
	// ever added beside it, this catches the mix before it 500s in prod.
	test('/forgot-password is default-only (single action)', () => {
		assertNoMixedActions(forgotActions);
		expect(Object.keys(forgotActions)).toEqual(['default']);
	});

	test('/reset-password is default-only (single action)', () => {
		assertNoMixedActions(resetActions);
		expect(Object.keys(resetActions)).toEqual(['default']);
	});
});
