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

const mailersWhere = (match: (source: (typeof LOCALE_SOURCE)[string]) => boolean) =>
	Object.entries(LOCALE_SOURCE)
		.filter(([, source]) => match(source))
		.map(([path]) => path);

/** Resolve their own base locale — the two this ticket changed. */
const baseLocaleMailers = () => mailersWhere((source) => source === 'base');
/** Render Paraglide copy at all, wherever the locale comes from. */
const localizedMailers = () => mailersWhere((source) => source !== 'none');
/** Claim to render no Paraglide copy — asserted, so `none` is a checked fact rather than a label. */
const unlocalizedMailers = () => mailersWhere((source) => source === 'none');

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
 * How many times a message is NAMED, called or not.
 *
 * Held equal to the call count below, which closes the hole a call-site scan cannot see: a message
 * function passed as a VALUE. `LinkEmailCopy.greeting` is `(args: { name: string }) => string` and a
 * Paraglide message is `(inputs, options?) => string`, so `greeting: m.activation_email_greeting`
 * type-checks — and it reads as a tidy-up of `greeting: (args) => m.activation_email_greeting(args, o)`,
 * which is exactly why someone would write it. The locale option then has no call site at all and
 * `buildLinkEmail` invokes it ambiently, i.e. in the request's locale.
 *
 * Deliberately a COUNT rather than the obvious `\bm\.\w+(?!\s*\()`. A negative lookahead after a
 * greedy `\w+` backtracks into the identifier until the lookahead is satisfied, so it reports a
 * prefix of every ordinary call (`m.waitlist_ack_subjec`) as a bare reference — measured, eleven
 * phantom hits on a clean file. Two counts cannot have that failure mode.
 */
const messageRefCount = (text: string): number => (text.match(/\bm\.\w+/g) ?? []).length;

/**
 * Strip braced groups, innermost first and repeatedly until nothing more goes.
 *
 * The loop is the point. A single `replace` pass removes only the INNERMOST braces, so
 * `{ a: { b: 1 }, c: 2 }` would come back as `{ a: , c: 2 }` — still carrying a comma that belongs to
 * the object rather than to a second argument, i.e. a false PASS, which is the one direction a guard
 * must not fail in. Unreachable with today's flat Paraglide params; three lines to make it stay that
 * way regardless.
 */
const withoutBracedGroups = (args: string): string => {
	let out = args;
	let previous = '';
	while (out !== previous) {
		previous = out;
		out = out.replace(/\{[^{}]*\}/g, '');
	}
	return out;
};

/**
 * Does this argument list carry a second, top-level argument — the locale option?
 *
 * Checking for "a second argument" rather than for the local variable's name keeps the rule from
 * breaking on a rename, which would be a false failure rather than a caught defect.
 */
const passesLocaleOption = (args: string): boolean => withoutBracedGroups(args).includes(',');

describe('email is never localized by whoever filled in the form', () => {
	// Non-vacuity first. Everything below is either a "nothing matched" or a per-path lookup, so a
	// derivation that found no files would make the whole suite quietly true. Same opening move as
	// `email-senders.spec.ts`, for the same reason.
	it('classifies every mailer, and only mailers', () => {
		expect(Object.keys(LOCALE_SOURCE).sort()).toEqual(mailers().sort());
		// The categories below drive `it.each`, and an empty one registers no tests at all rather
		// than failing — so the two that carry assertions are pinned as non-empty here.
		expect(baseLocaleMailers().length).toBeGreaterThan(0);
		expect(localizedMailers().length).toBeGreaterThan(0);
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
	//
	// EVERY localized mailer, not only the two this ticket changed. `base` and `caller` differ in
	// WHERE the locale comes from, and neither of them wants the ambient one — an activation email
	// silently falling back to the request locale is DAR-67's bug, not a lesser version of it. So the
	// rule is the same for all of them and only `none` is excluded, which is asserted below rather
	// than assumed.
	it.each(localizedMailers())('passes an explicit locale to every message call in %s', (path) => {
		const text = sourceText(path);
		const calls = messageCallArgs(text);

		// Parsed every call, and there is something to parse — otherwise a builder whose arguments
		// nest too deeply for the pattern would drop out of the check unnoticed.
		expect(calls.length).toBe(messageCallCount(text));
		expect(calls.length).toBeGreaterThan(0);

		// Every message NAMED here is also called here — see messageRefCount. A message handed on as a
		// value (`greeting: m.activation_email_greeting`) has no call site to inspect, so the locale
		// option cannot be checked for and whoever invokes it gets the ambient locale.
		expect(
			messageRefCount(text),
			`${path} names a message it does not call — passing a message function as a value leaves ` +
				`its locale to whoever invokes it, which is the ambient (request) locale. Wrap it: ` +
				`(args) => m.the_key(args, o).`
		).toBe(calls.length);

		for (const args of calls) {
			expect(
				passesLocaleOption(args),
				`m.…(${args}) in ${path} renders in the AMBIENT locale — the request's — because it ` +
					`passes no locale option. No mailer wants that: it is mail, and the person reading it ` +
					`is not the person who made the request (DAR-173). Pass this module's options object ` +
					`as the second argument.`
			).toBe(true);
		}
	});

	// The other side of that: `none` claims the module renders no Paraglide copy at all, and a claim
	// nothing checks is a label. Asserting it is what stops `none` becoming the quiet way past the
	// rule above — mark a new mailer `none`, and it must actually contain no message calls.
	it.each(unlocalizedMailers())('renders no Paraglide copy in %s', (path) => {
		// Names one at all, not merely calls one — the same value-passing route as above.
		expect(messageRefCount(sourceText(path))).toBe(0);
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
