import { describe, expect, it } from 'vitest';
import {
	appSourcePaths,
	importedNames,
	importsDynamically,
	importsNamespace,
	scriptSourcePaths,
	sourceText
} from './source-scan';

// DAR-173. WHICH LANGUAGE A MESSAGE GOES OUT IN IS NOT THE FORM SUBMITTER'S TO DECIDE.
//
// The waitlist form is unauthenticated, so the person who types an address need not own it, and both
// waitlist mailers used to render in the locale of whoever submitted the form. For DAR-139's
// confirmation request that is not an edge case, it is the premise: the message asks "someone asked
// us to send updates here — was it you?", so rendering it in a language chosen by the person we are
// asking ABOUT can leave the recipient unable to answer the one question the message exists to ask.
//
// The rule those two now follow: a message whose job is to be ANSWERED must be readable by whoever
// receives it, and when we cannot know who that is, that means the base locale. It is not new — it is
// what DAR-67's activation email has always done, for the same reason (an operator sends it to
// somebody else). The contact ack keeps the request locale deliberately: it is a reply to whoever
// just wrote in, so a wrong language there is cosmetic rather than disabling.
//
// TWO ROUTES IN, AND A SIGNATURE CLOSES ONLY ONE. A mailer can end up localized by the request
// because its CALLER passes a locale — closed by deleting the parameter, pinned by the
// `@ts-expect-error` in each mailer's own spec — or because the mailer reaches for one ITSELF, which
// no signature can see. That second route is this file's job, and it has two shapes: importing
// `getLocale`, and simply calling `m.foo()` with no locale option, which resolves the ambient locale
// while importing nothing at all. The second is the likelier mistake, because it is how every
// `.svelte` on the site legitimately calls a message.
//
// WHY NOT A REPO-WIDE `getLocale` ALLOWLIST (DAR-102's usual shape): counted against the tree, seven
// non-test files import it and five are `.svelte` components formatting a date, where it is correct
// and necessary. A list over that set would fail on every new page that renders a date and would be
// loosened until it caught nothing — DAR-152's failure mode. So the rule is scoped to the MAILERS,
// where the answer is unambiguous.

const EMAIL_MODULE = '$lib/server/email';
const RUNTIME = '$lib/paraglide/runtime';
const SEND = 'postEmail';

/** The same derivation `email-senders.spec.ts` uses: whoever imports the one function that posts. */
const surface = () => [...appSourcePaths(), ...scriptSourcePaths()];
const mailers = () => surface().filter((path) => importedNames(path, EMAIL_MODULE).includes(SEND));

/**
 * Where each mailer's locale comes from.
 *
 * `base` — the module resolves `baseLocale` itself and takes no locale at all. Asserted below.
 * `caller` — takes a `Locale` parameter; every call site passes `baseLocale`.
 * `request` — takes a `Locale` parameter; the call site passes the request locale, on purpose.
 * `none` — renders no Paraglide copy (English literals into `info@`).
 *
 * `caller` vs `request` is a fact about the CALL SITE, not about the module, so this file DECLARES
 * the difference and does not verify it — the same honesty `email-senders.spec.ts` states about
 * `kind`. What it buys is that the distinction is written down where a new mailer's author meets it.
 *
 * A COMPLETE CLASSIFICATION, not a list of the two files this ticket touched, and the polarity is
 * the reason. A hand-kept list of files TO SCAN goes blind when an entry is deleted (DAR-99 measured
 * that at 7/7 passing against a drifted file); a classification asserted EQUAL to the derived mailer
 * set fails in both directions — a new mailer is unclassified until someone writes down what it does,
 * and a deleted entry breaks the equality.
 */
const LOCALE_SOURCE: Record<string, 'base' | 'caller' | 'request' | 'none'> = {
	'src/lib/server/waitlist-notify.ts': 'base',
	'src/lib/server/waitlist-updates-notify.ts': 'base',
	'src/lib/server/contact-notify.ts': 'request',
	'src/lib/server/activation-email.ts': 'caller',
	'src/lib/server/verification-email.ts': 'caller',
	'src/lib/server/password-reset-email.ts': 'caller',
	'src/lib/server/waitlist-priority-notify.ts': 'none'
};

const baseLocaleMailers = () =>
	Object.entries(LOCALE_SOURCE)
		.filter(([, source]) => source === 'base')
		.map(([path]) => path);

/**
 * Every `m.<key>(…)` call's argument list. One level of nested parens is handled (an `escapeHtml(…)`
 * inside the arguments); anything deeper is not skipped silently — the count check beside each use
 * requires as many parsed calls as there are `m.<key>(` occurrences.
 *
 * Comments are already stripped by `sourceText`, so prose naming a message key cannot trip this.
 */
const messageCallArgs = (text: string): string[] =>
	[...text.matchAll(/\bm\.\w+\(((?:[^()]|\([^()]*\))*)\)/g)].map((match) => match[1]);

const messageCallCount = (text: string): number => (text.match(/\bm\.\w+\(/g) ?? []).length;

/**
 * Does this argument list carry a second, top-level argument — the locale option?
 *
 * Braced groups go first, so the comma inside `{ name: sub.name }` is not mistaken for one. Checking
 * for "a second argument" rather than for the local variable's name keeps the rule from breaking on a
 * rename, which would be a false failure rather than a caught defect.
 */
const passesLocaleOption = (args: string): boolean => args.replace(/\{[^{}]*\}/g, '').includes(',');

describe('email is never localized by whoever filled in the form', () => {
	// Non-vacuity first. Everything below is either a "nothing matched" or a per-path lookup, so a
	// derivation that found no files would make the whole suite quietly true. Same opening move as
	// `email-senders.spec.ts`, for the same reason.
	it('classifies every mailer, and only mailers', () => {
		expect(Object.keys(LOCALE_SOURCE).sort()).toEqual(mailers().sort());
		// The `base` half is what the assertions below iterate; an empty one would register no tests
		// at all rather than failing.
		expect(baseLocaleMailers().length).toBeGreaterThan(0);
	});

	// THE ROUTE NO SIGNATURE CAN SEE, first shape. A mailer that called `getLocale()` internally would
	// be localized by the request with no parameter anywhere to give it away. Absolute — no allowlist,
	// because no mailer has a reason to ask what language the current REQUEST is in: a message is
	// rendered for its recipient, who is not the person making the request.
	//
	// All three reach-routes, because a by-name rule has more than one way past it and this repo has
	// measured every one of them (DAR-102's alias/namespace/re-export, DAR-121's dynamic import).
	// `importedNames` reports an alias by its exported name and covers `export … from`, so the two
	// checks beside it are the remaining pair.
	it('lets no mailer resolve the request locale for itself', () => {
		const byName = mailers().filter((path) => importedNames(path, RUNTIME).includes('getLocale'));
		const sideways = mailers().filter(
			(path) => importsNamespace(path, RUNTIME) || importsDynamically(path, RUNTIME)
		);
		expect(byName).toEqual([]);
		expect(sideways).toEqual([]);
	});

	// THE SECOND SHAPE, and the one an import check is blind to: `m.foo()` with no options resolves
	// the ambient locale — i.e. the request's — while importing nothing. It is also the natural way to
	// call a message, so a new line added to one of these builders is likelier to be wrong this way
	// than any other. Nothing but the source can see it: the types are identical either way, and the
	// rendered output is identical too while `es.json` is empty.
	it.each(baseLocaleMailers())('passes an explicit locale to every message call in %s', (path) => {
		const text = sourceText(path);
		const calls = messageCallArgs(text);

		// Parsed every call, and there is something to parse — otherwise a builder whose arguments
		// nest too deeply for the pattern would drop out of the check unnoticed.
		expect(calls.length).toBe(messageCallCount(text));
		expect(calls.length).toBeGreaterThan(0);

		for (const args of calls) {
			expect(
				passesLocaleOption(args),
				`m.…(${args}) in ${path} renders in the AMBIENT locale — the request's — because it ` +
					`passes no locale option. This mailer writes to an address a stranger may have typed ` +
					`(DAR-173): pass the module's base-locale options object as the second argument.`
			).toBe(true);
		}
	});

	// Two-sided, so the rule cannot rot in either direction: the positive half fails if one of these
	// modules stops rendering copy in the base locale, the negative half if a caller-chosen locale
	// creeps back. `Locale` is banned rather than only `getLocale` because naming that type is what a
	// locale PARAMETER looks like — which is the thing that was deleted.
	it.each(baseLocaleMailers())('renders %s in the base locale and names no other', (path) => {
		const names = importedNames(path, RUNTIME);
		expect(names).toContain('baseLocale');
		expect(names).not.toContain('Locale');
		expect(names).not.toContain('getLocale');
	});
});
