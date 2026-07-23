import { describe, expect, test } from 'vitest';
import { actions as signupActions } from './signup/+page.server';
import { actions as loginActions } from './login/+page.server';

// Regression guard (#119/#121). SvelteKit's `check_named_default_separate` 500s EVERY POST to a page
// whose `actions` object mixes a `default` action with named ones — not just a POST to the default.
// #119 (signup) and #121 (login) each added a `resend` NAMED action beside the original `default`,
// which silently broke both auth form submits in production (the hermetic unit tests call
// `auth.api.*` directly and the e2e only GETs, so neither exercised a real action POST). These pin
// that every action on the two auth pages is NAMED — a `default` reappearing here would reintroduce
// the 500. The forms post to the matching `?/<name>` (signup/+page.svelte, LoginForm.svelte).
function assertAllNamed(actions: Record<string, unknown>) {
	const keys = Object.keys(actions);
	// The pages have >1 action, so per SvelteKit they MUST all be named (no bare `default`).
	expect(keys.length).toBeGreaterThan(1);
	expect(keys).not.toContain('default');
}

describe('auth pages use only named actions (no `default` beside named) — #119/#121 regression', () => {
	test('/signup exposes named actions only', () => {
		assertAllNamed(signupActions);
		expect(Object.keys(signupActions).sort()).toEqual(['resend', 'signup']);
	});

	test('/login exposes named actions only', () => {
		assertAllNamed(loginActions);
		expect(Object.keys(loginActions).sort()).toEqual(['resend', 'signin']);
	});
});
