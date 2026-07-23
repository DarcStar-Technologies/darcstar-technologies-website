import { describe, expect, test } from 'vitest';
import { actions as signupActions } from './signup/+page.server';
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
	// signup/login are named-only (each has a `resend` beside the sign-up/sign-in action), so their
	// forms post to `?/<name>` (signup/+page.svelte, LoginForm.svelte).
	test('/signup is named-only', () => {
		assertNoMixedActions(signupActions);
		expect(Object.keys(signupActions).sort()).toEqual(['resend', 'signup']);
	});

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
