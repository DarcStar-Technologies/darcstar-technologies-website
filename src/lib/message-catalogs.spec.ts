import { describe, expect, it } from 'vitest';
import settings from '../../project.inlang/settings.json';

// DAR-53. `messages/es.json` used to be a byte-identical copy of `en.json` — the documented
// "English placeholder" convention — so Paraglide compiled two identical function bodies for each
// of the 829 messages (~39 KB of duplicate JS across the client bundle; /privacy alone -33%).
// Omitting an untranslated key instead compiles the base-locale fallback as a free alias
// (`const es_x = en_x`) with byte-identical rendered output.
//
// The old convention was written down too, and being written down is exactly what failed to keep
// it. So this spec is the convention: it is a FORWARD guard, currently satisfied by an empty file,
// and it is what stops the mirror growing back one "just this key" at a time.
//
// Both failure modes below were reproduced against a real `paraglide-js compile` before this spec
// was written. Neither errors and neither warns — there is no message-lint module in
// `project.inlang/settings.json`, which is also why the compile stayed green when the copy drifted.

/** The inlang message-format pointer, not a message. Every other key in these files is one. */
const SCHEMA_KEY = '$schema';

// Derived from the files themselves rather than a hardcoded import pair, so a locale added to
// `messages/` cannot quietly sit outside these rules. A broken glob is loud in both directions:
// the locale-set assertion below fails, and vitest errors on a `describe.each` that registers no
// tests.
const catalogs = Object.entries(
	// `unknown`, not `string`: every message is a plain string today, but the inlang format also
	// allows a variant/plural object, and typing that away is how the rule below would quietly stop
	// applying to exactly the messages most likely to be copied wholesale.
	import.meta.glob<Record<string, unknown>>('../../messages/*.json', {
		eager: true,
		import: 'default'
	})
).map(([path, raw]) => {
	const messages = { ...raw };
	delete messages[SCHEMA_KEY];
	return { locale: path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''), messages };
});

// `!` because a base locale with no catalog is not a state this repo can reach quietly: Paraglide
// resolves every message against it, so the compile — and therefore the build — goes first. If it
// somehow happened, the rules below throw rather than pass, which is the safe direction.
const base = catalogs.find(({ locale }) => locale === settings.baseLocale)!;
const translations = catalogs.filter(({ locale }) => locale !== settings.baseLocale);

// `[label, value]` tuples with `%s`, matching the sibling boundary specs — `describe.each` over bare
// objects renders `$locale` as "undefined" here, and a failure has to name the file it is about.
describe.each(translations.map(({ locale, messages }) => [locale, messages] as const))(
	'messages/%s.json carries only real translations',
	(_locale, messages) => {
		// No allowlist, deliberately — and the objection to answer is "some Spanish strings really are
		// the English ones" ("Email", "Admin", proper nouns). That is true and it changes nothing:
		// omitting such a key renders the SAME text and ships less JS, so "omit it" is the correct fix
		// in every case, not just the untranslated ones. The cost is that the file stops recording
		// "a human looked at this and it's the same" — a translator-workflow concern, not a rendering
		// one, and not worth 829 duplicated literals.
		it('repeats no base-locale value verbatim — omit the key, Paraglide falls back for free', () => {
			// Compared serialized rather than by `===` so a variant/plural object is checked by value
			// too; `===` would only ever match strings, and a copied object is never the same
			// reference. What this guards against IS a copy, and a copy serializes identically, so
			// there is no key-order caveat. `hasOwn` for the same reason as the orphan check below.
			const mirrored = Object.entries(messages)
				.filter(
					([key, value]) =>
						Object.hasOwn(base.messages, key) &&
						JSON.stringify(base.messages[key]) === JSON.stringify(value)
				)
				.map(([key]) => key);
			expect(mirrored).toEqual([]);
		});

		// The guarantee a copied catalog used to give structurally. A key present ONLY in a translation
		// compiles a message whose BASE variant is the key name as a literal — `const en_x = () => 'x'`.
		// The realistic shape is a typo'd key: the correctly-spelled one still exists and still renders
		// English, so the translation silently never applies. That is the DAR-73 failure again — an edit
		// that renders nowhere, with no feedback.
		it('defines no key the base locale is missing — the base render would emit the key name', () => {
			// `Object.hasOwn`, not `key in`: `in` walks the prototype chain, so a message keyed
			// `constructor` or `toString` would look present in a base catalog that never defined it
			// and the orphan would slip through.
			const orphans = Object.keys(messages).filter((key) => !Object.hasOwn(base.messages, key));
			expect(orphans).toEqual([]);
		});
	}
);

describe('the locale set', () => {
	it('matches the catalogs on disk', () => {
		expect(catalogs.map(({ locale }) => locale).sort()).toEqual([...settings.locales].sort());
	});

	// `evidence-boundary.spec.ts` (IP boundary) and `safety-language.spec.ts` (truth boundary) scan
	// the catalogs to keep a leak from shipping through a locale the e2e never visits — and they
	// import `en` and `es` BY NAME. Nothing in those files can notice a third catalog, and this is
	// the only place that can say so, so the coupling is pinned here instead of left implicit
	// (DAR-71's "pin it twice when it can't be single-sourced"). Adding a locale? Add it to both
	// boundary specs, then update this list.
	it('is still the pair the boundary specs import by name', () => {
		expect([...settings.locales].sort()).toEqual(['en', 'es']);
	});
});
