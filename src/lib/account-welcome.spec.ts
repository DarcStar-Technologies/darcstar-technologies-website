import { describe, expect, it } from 'vitest';
import { ACCOUNT_WELCOME_CALLBACK, WELCOME_FLAG, isWelcome } from './account-welcome';

const base = 'https://darcstar.tech';

describe('account welcome flag (#106)', () => {
	it('round-trips: the callback the auth actions send is exactly what the page recognises', () => {
		// The load-bearing contract. The sign-up / resend actions pass ACCOUNT_WELCOME_CALLBACK as the
		// verify callbackURL; Better Auth preserves the query through the verify redirect (its
		// matchesOriginPattern relative-path branch has an explicit `(?:\?…)?` group), landing the
		// verified user on that URL; /account then calls isWelcome(page.url) to raise the banner. If
		// either end's flag drifts, this fails.
		expect(isWelcome(new URL(ACCOUNT_WELCOME_CALLBACK, base))).toBe(true);
	});

	it('recognises the welcome flag when set to 1', () => {
		expect(isWelcome(new URL('/account?welcome=1', base))).toBe(true);
	});

	it('ignores a missing or non-matching flag', () => {
		expect(isWelcome(new URL('/account', base))).toBe(false);
		expect(isWelcome(new URL('/account?welcome=0', base))).toBe(false);
		expect(isWelcome(new URL('/account?welcome=yes', base))).toBe(false);
		expect(isWelcome(new URL('/account?other=1', base))).toBe(false);
	});

	it('sends a RELATIVE callback (Better Auth rejects a non-relative callbackURL not in trustedOrigins)', () => {
		expect(ACCOUNT_WELCOME_CALLBACK.startsWith('/')).toBe(true);
		expect(ACCOUNT_WELCOME_CALLBACK).toContain(`${WELCOME_FLAG}=1`);
	});
});
