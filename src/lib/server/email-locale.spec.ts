import { describe, expect, it } from 'vitest';
import { appSourcePaths, importedNames, scriptSourcePaths } from './source-scan';

// DAR-173. WHICH LANGUAGE A MESSAGE GOES OUT IN IS NOT THE SENDER'S CALLER'S TO DECIDE.
//
// The waitlist form is unauthenticated, so the person who types an address need not own it, and both
// waitlist mailers used to render in the locale of whoever submitted the form. For DAR-139's
// confirmation request that is not an edge case, it is the premise: the message asks "someone asked
// us to send updates here — was it you?", so rendering it in a language chosen by the person we are
// asking ABOUT can leave the recipient unable to answer the one question the message exists to ask.
//
// The rule those two now follow: a message whose job is to be ANSWERED must be readable by whoever
// receives it, and when we cannot know who that is, that means the base locale. It is not new — it is
// what DAR-67's activation email has always done, for the same reason (it is sent by an operator to
// somebody else). The contact ack keeps the request locale deliberately: it is a reply to whoever
// just wrote in, so a wrong language there is cosmetic rather than disabling.
//
// TWO ROUTES, AND THE TYPE SYSTEM ONLY CLOSES ONE. A mailer can end up localized by the request
// because its CALLER passes a locale — closed by deleting the parameter, pinned by the
// `@ts-expect-error` in each mailer's own spec — or because the mailer resolves one ITSELF. Nothing
// about a signature can see the second, so it is checked here, on the source.
//
// WHY NOT A REPO-WIDE `getLocale` ALLOWLIST (DAR-102's usual shape): measured against the tree, most
// importers are `.svelte` files formatting dates, where `getLocale()` is correct and necessary. A
// list over that set would fail on every new page that renders a date and would be loosened until it
// caught nothing — DAR-152's failure mode. The narrower "no file that sends mail may import
// getLocale" needs an allowlist entry for `contact.remote.ts`, a file that legitimately does exactly
// that. So the rule is scoped to the MAILERS, where the answer is unambiguous.

const EMAIL_MODULE = '$lib/server/email';
const RUNTIME = '$lib/paraglide/runtime';
const SEND = 'postEmail';

/** The same derivation `email-senders.spec.ts` uses: whoever imports the one function that posts. */
const surface = () => [...appSourcePaths(), ...scriptSourcePaths()];
const mailers = () => surface().filter((path) => importedNames(path, EMAIL_MODULE).includes(SEND));

/**
 * The mailers this ticket moved to the base locale. Hand-listed and SMALL on purpose — this is not
 * the allowlist rejected above, it is the two files whose signatures changed, and both assertions
 * below are two-sided so a stale path here fails rather than passing vacuously.
 */
const BASE_LOCALE_MAILERS = [
	'src/lib/server/waitlist-notify.ts',
	'src/lib/server/waitlist-updates-notify.ts'
];

describe('email is never localized by whoever filled in the form', () => {
	// Non-vacuity first. Every assertion below is a "nothing matched" or a per-path lookup, so a
	// derivation that found no files, or a list naming files that have moved, would make the whole
	// suite quietly true. Same opening move as `email-senders.spec.ts`, for the same reason.
	it('found the mailers, including the two this rule names', () => {
		expect(mailers().length).toBeGreaterThan(0);
		for (const path of BASE_LOCALE_MAILERS) expect(mailers()).toContain(path);
	});

	// THE ROUTE A SIGNATURE CANNOT SEE. A mailer that called `getLocale()` internally would be
	// localized by the request with no parameter anywhere to give it away. Absolute — no allowlist,
	// because no mailer has a reason to ask what language the current request is in. A message is
	// rendered for its RECIPIENT, who is not the person making the request.
	it('lets no mailer resolve the request locale for itself', () => {
		const resolvers = mailers().filter((path) =>
			importedNames(path, RUNTIME).includes('getLocale')
		);
		expect(resolvers).toEqual([]);
	});

	// TWO-SIDED, so the rule cannot rot in either direction: the positive half fails if one of these
	// paths goes stale (or the module stops rendering copy at all), the negative half fails if a
	// caller-chosen locale creeps back. `Locale` is banned rather than merely `getLocale` because
	// naming that type is what a locale PARAMETER looks like — which is the thing that was deleted.
	it.each(BASE_LOCALE_MAILERS)('renders %s in the base locale and names no other', (path) => {
		const names = importedNames(path, RUNTIME);
		expect(names).toContain('baseLocale');
		expect(names).not.toContain('Locale');
		expect(names).not.toContain('getLocale');
	});
});
