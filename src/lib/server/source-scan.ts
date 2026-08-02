// TEST SUPPORT — source sets for the specs that enforce rules TypeScript cannot hold. Nothing in
// production imports this.
//
// Three of those specs read source: DAR-99's one signing secret (`waitlist-secret.spec.ts`), DAR-83's
// honeypot gate on the funnel (`waitlist-funnel.spec.ts`), and DAR-121's "who may send email"
// (`email-senders.spec.ts`). The reading, comment-stripping and import-parsing live here once,
// because copies of them are the drift all three tickets exist to prevent.
//
// THE SURFACES ARE NOT THE SAME SET, and that is deliberate rather than an oversight:
//
//   - `appSourcePaths()` — everything under `src`. The funnel gate needs this, because the question
//     it asks ("who imports the ungated capture function?") has no reason to stop at a directory
//     boundary. Scoping it to the waitlist's own folders is exactly the DAR-102 defect one level up:
//     a step endpoint added under `src/routes/waitlist/step5/` or `src/routes/api/` would escape.
//   - `waitlistSourcePaths()` — the waitlist's own modules. The secret rule needs this NARROWER set,
//     because `auth.ts` legitimately names the signing key (it is Better Auth's own), so "named in
//     exactly one file" is only ever true of the waitlist.
//   - `scriptSourcePaths()` — the hand-run `scripts/`, WIDER than the worker. DAR-121's rule (who may
//     send email) needs it because a script is how a one-off blast would actually get written here;
//     the deployed-worker rules above must not have it, for the reason on `appSourcePaths()`.
//
// WHY DERIVED AND NOT A PATH LIST. Measured during DAR-99, on the hand-written list this replaced:
// dropping one entry AND drifting that file in the same breath passed 7/7. A hand-written scan list
// has no failure mode that points at itself — deleting an entry makes the scan blind, silently. So
// the sets come from the tree, and the specs assert a FLOOR of known-critical paths instead, which
// fails loudly if a derivation ever stops matching.
//
// (An exception ALLOWLIST is the opposite polarity and stays hand-written for that reason — see
// `waitlist-funnel.spec.ts`. Deleting an entry there makes the rule stricter, so it fails loud.)
//
// WHY `node:fs` AND NOT `import.meta.glob`, which is the idiom elsewhere in this repo: a raw glob
// asks Vite to load the file, and SvelteKit's remote-module plugin refuses `.remote.ts` under
// `?raw` ("Cannot export `default` from a remote module"). The four remote modules are most of the
// point of scanning at all, so the reader has to be one that treats them as plain text.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/**
 * Every non-spec file under `root` with one of `extensions`, RECURSIVELY, as `path → source`.
 *
 * Recursive is load-bearing, not tidiness: a flat read was measured to pass 56/56 against a
 * token-gated step planted in `src/routes/waitlist/step5/+page.server.ts` — DAR-102's own failure
 * mode, one directory deeper than the fix meant to close it.
 *
 * Specs are excluded, and it is the one exclusion: a fixture has no request to resolve a secret from
 * and no endpoint to gate, so writing either longhand is the honest way to state it.
 */
const read = (root: string, extensions: string[]): Record<string, string> =>
	Object.fromEntries(
		readdirSync(root, { withFileTypes: true, recursive: true })
			.filter(
				(entry) =>
					entry.isFile() &&
					extensions.some((extension) => entry.name.endsWith(extension)) &&
					!entry.name.includes('.spec.') &&
					!entry.name.includes('.test.') &&
					!entry.name.includes('.e2e.')
			)
			.map((entry): [string, string] => {
				const path = join(entry.parentPath, entry.name);
				return [path, readFileSync(path, 'utf8')];
			})
	);

// `scripts` is read too, and the extension lists differ on purpose. Under `src` only `.ts` can be a
// module at all; under `scripts` the tree is mixed — the ones that reach app code are `.ts` run
// under tsx (tsconfig covers `scripts/**/*.ts`, which is the whole reason they are `.ts`), while the
// `.mjs` ones can still hand-roll an HTTP call to a third party. A rule about who may reach an
// outside service has to see both.
const SOURCES: Record<string, string> = {
	...read('src', ['.ts']),
	...read('scripts', ['.ts', '.mjs'])
};

// Markup is read into a set of its OWN rather than folded into `SOURCES`, for the same reason the
// three sets above are separate. Every rule that reads `SOURCES` asks a question about MODULES — who
// imports the ungated capture, who resolves the signing secret, who may reach the mail provider — and
// `.svelte` files would answer all three with noise while widening `waitlistSourcePaths()`, which
// filters by basename, and `appSourcePaths()`, which two rules use as "the deployed worker". The
// question markup answers is a different one (DAR-218: does a `class` attribute re-type a string that
// `$lib/styles.ts` already exports), so it gets a set instead of a flag on an existing one.
const MARKUP: Record<string, string> = read('src', ['.svelte']);

/**
 * Every non-spec source file under `src`, repo-relative. Vitest runs from the project root.
 *
 * DELIBERATELY STILL `src`-ONLY, though `SOURCES` now holds more: the two rules that ask this for
 * their surface are about what the deployed worker does, and `waitlistSourcePaths()` filters this by
 * BASENAME — so widening it here would silently pull `scripts/smoke-waitlist.ts` into DAR-99's
 * "named in exactly one file" rule. A scan that wants the scripts asks for them (below).
 */
export const appSourcePaths = (): string[] =>
	Object.keys(SOURCES).filter((path) => path.startsWith('src/'));

/**
 * The hand-run scripts (`scripts/`), which are NOT part of the deployed worker and are exactly why
 * they need a set of their own: two of them already send real mail as a side effect
 * (`smoke-invite.ts`, `smoke-waitlist.ts`), so "someone writes a script that mails the list" is this
 * repo's established shape for outbound mail rather than a hypothetical one. Measured during DAR-121:
 * `email-senders.spec.ts` passed 7/7 against a marketing blast planted at `scripts/blast.ts` while
 * its surface was `src`-only — DAR-102's defect, one directory sideways.
 */
export const scriptSourcePaths = (): string[] =>
	Object.keys(SOURCES).filter((path) => path.startsWith('scripts/'));

/**
 * The waitlist's own modules: its route tree, plus the `waitlist`-prefixed files in `$lib` (which
 * holds far more than the waitlist, so there the filename is what scopes it).
 */
export const waitlistSourcePaths = (): string[] =>
	appSourcePaths().filter(
		(path) =>
			path.startsWith('src/routes/waitlist/') ||
			path.slice(path.lastIndexOf('/') + 1).startsWith('waitlist')
	);

/**
 * One file's source, with comments removed.
 *
 * Load-bearing. These files discuss the very names the specs scan for — the ungated capture function
 * and the signing-secret env key are both named in prose, repeatedly — so a scan over raw text would
 * either trip on every explanation or be loosened until it stopped catching anything. Stripping first
 * is what lets the assertions be exact. (This comment deliberately paraphrases rather than quoting
 * those names: a scanned file shouldn't rely on the stripper to stay clean.)
 *
 * Deliberately conservative: only WHOLE-LINE `//` comments go, so a trailing one naming a scanned
 * symbol fails its spec. That is the safe direction — loud and wrong beats silent and wrong — and it
 * is why this doesn't try to be clever about `//` inside string literals, where a URL would make it
 * eat real code and produce exactly the false PASS these specs exist to prevent.
 */
export const sourceText = (path: string): string =>
	(SOURCES[path] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every `.svelte` file under `src`, repo-relative. See `MARKUP` for why this is its own set. */
export const markupSourcePaths = (): string[] => Object.keys(MARKUP);

/**
 * Strip every occurrence of `pattern`, REPEATEDLY, until the text stops changing.
 *
 * One pass is not enough, and it is the defect DAR-173 already found in its brace-stripper: removing
 * a match can splice its neighbours into a NEW delimiter. Measured — `<scr<script>a</script>ipt>b</script>c`
 * loses only the inner block on the first pass, leaving `<script>b</script>c`, i.e. real script body
 * (`b`) sitting in what the caller is about to treat as markup. That is a scan reading a script's
 * class-name mentions as if they were hand-written attributes: a FALSE FAILURE, the one direction a
 * guard must never produce.
 *
 * (CodeQL flags the single-pass form as "incomplete multi-character sanitization". As a SECURITY
 * finding that is a false positive — this is test support, reading files already committed to the
 * repo, and its output reaches assertions rather than a DOM. The correctness point underneath is
 * real and the repo had already paid for it once, which is why this is fixed rather than dismissed.)
 */
export const stripToFixedPoint = (text: string, pattern: RegExp): string => {
	let previous: string;
	let current = text;
	do {
		previous = current;
		current = current.replace(pattern, '');
	} while (current !== previous);
	return current;
};

/**
 * One component's markup, with its `<script>` blocks and comments removed.
 *
 * The `<script>` pattern is case-INSENSITIVE and tolerates whitespace in the closing tag. Svelte
 * accepts only a lowercase `<script>`, so `<SCRIPT>` is unreachable in a file that compiles — but a
 * stripper exhaustive only for inputs it assumes well-formed is the shape DAR-102 warns about, and
 * the flag costs nothing.
 *
 * The script has to go, not just the comments: a component that legitimately IMPORTS a shared class
 * string mentions that string's NAME, and several of them build local class expressions in script —
 * so a scan of the whole file would read the module's own consumers as if they were re-typing it.
 * What is left is the part where a `class` attribute can be hand-written.
 *
 * Both comment syntaxes go, because markup carries `<!-- -->` and the removed script carried `//`;
 * the ones in this repo discuss class names constantly (this file's own rule is discussed in three
 * of them), so a raw scan would trip on the explanations rather than on the code.
 */
/**
 * What `markupText` removes, in order. Exported so a spec can assert the patterns THEMSELVES.
 *
 * That indirection is not ceremony — it was mutation-measured. With these inlined, dropping the `i`
 * flag left all 17 tests green, because the case test handed `stripToFixedPoint` its own regex and
 * so pinned the helper while saying nothing about what the caller passes it. A test that reads as
 * coverage while proving nothing is worse than no test (DAR-171).
 *
 * Sharing module-level `/g` regexes across calls is safe here: `String.replace` resets `lastIndex`.
 */
export const MARKUP_STRIP_PATTERNS = [
	// The closing tag accepts trailing junk — `</script bar>` really does close a script, because an
	// HTML end tag's attributes are a parse error the parser then ignores rather than a reason not to
	// close. `\s*>` misses it and would leave the whole block in the text. Unreachable through Svelte,
	// which rejects it, but "exhaustive only for input I assume is well-formed" is what DAR-102 is
	// about, and CodeQL's `js/bad-tag-filter` names this exact case.
	/<script[\s\S]*?<\/script(?:\s[^>]*)?>/gi,
	/<!--[\s\S]*?-->/g,
	/\/\*[\s\S]*?\*\//g
];

export const markupText = (path: string): string =>
	MARKUP_STRIP_PATTERNS.reduce(
		(text, pattern) => stripToFixedPoint(text, pattern),
		MARKUP[path] ?? ''
	);

/**
 * Every literal `class="…"` value in a component's markup, as a token list.
 *
 * LITERALS ONLY, deliberately: `class={fieldLabelClass}` is the correct form this rule exists to
 * push people toward, so reading it would report every fixed call site as a violation. A mixed
 * `class="{submitButtonClass} order-1"` yields its literal tokens with the `{…}` holes dropped,
 * which is right — the shared part is already shared, and what is left is the delta being added.
 */
export const classLiterals = (path: string): string[][] =>
	[...markupText(path).matchAll(/\bclass=("|')([^"']*)\1/g)].map(([, , value]) =>
		value
			.replace(/\{[^}]*\}/g, ' ')
			.split(/\s+/)
			.filter(Boolean)
	);

/**
 * Split `source` at its TOP-LEVEL commas — the ones not inside a bracket pair or a string.
 *
 * Exported for its own tests. A comma is the only boundary an object literal's properties reliably
 * have, and every comma inside a SvelteKit form action is nested by construction: the destructured
 * `({ request, locals })` sits inside a paren AND a brace, and everything else sits inside the arrow
 * function's own body braces. So depth alone separates one action from the next.
 *
 * Strings are skipped whole, template literals included, because a comma inside one is otherwise a
 * split in the middle of an action — which does not produce a false pass (the fragment stops parsing
 * as `name: value` and its caller fails loudly) but does produce a confusing one.
 *
 * A REGEX LITERAL is not skipped, and the failure direction is the same loud one: `/\(/` would open a
 * bracket that never closes, mis-splitting from there on. Telling a regex from a division needs the
 * preceding token, which is a tokenizer, and none of the files this reads contains one — so the cost
 * of getting it wrong is a red test naming the file rather than a rule that quietly stops applying.
 *
 * The scan STOPS at the first unmatched closer, so a caller may hand it everything after an opening
 * brace and get back only what that brace contained. Reading to the end instead would work today
 * purely because `actions` happens to be the last export in all five files it is pointed at, which is
 * not a property anything holds in place.
 */
export function splitTopLevel(source: string): string[] {
	const segments: string[] = [];
	let depth = 0;
	let start = 0;
	let i = 0;
	for (; i < source.length; i++) {
		const char = source[i];
		if (char === "'" || char === '"' || char === '`') {
			// Skip to the closing quote. An unterminated one runs to the end, which loses the tail —
			// caught by the caller's "every segment parses" assertion rather than passing silently.
			for (i++; i < source.length && source[i] !== char; i++) if (source[i] === '\\') i++;
			continue;
		}
		if (char === '{' || char === '(' || char === '[') depth++;
		else if (char === '}' || char === ')' || char === ']') {
			if (depth === 0) break;
			depth--;
		} else if (char === ',' && depth === 0) {
			segments.push(source.slice(start, i));
			start = i + 1;
		}
	}
	segments.push(source.slice(start, i));
	return segments.filter((segment) => segment.trim());
}

/**
 * The form actions a `+page.server.ts` exports, as `name → source` (the whole `name: async (…) => {…}`
 * property, comments already stripped).
 *
 * Returns `{}` for a file exporting no `actions`. THROWS when it finds the export and cannot parse it
 * — the caller's rule is "every action carries a gate", and an action the parser silently dropped is
 * an action reported as gated, which is the one answer a guard here must never give.
 *
 * KNOWN CONSTRAINT, stated rather than papered over: an action written as a bare reference to a
 * function declared elsewhere (`delete: guardedDelete`) yields a segment with no gate in it and fails.
 * That is a false failure in the letter and the right answer in the spirit — the rule is that an
 * action authorizes itself where a reader can see it — but it means this scan constrains where these
 * particular functions may be factored to (DAR-181's lesson, one file over). All 18 today are inline.
 */
export function formActions(path: string): Record<string, string> {
	const text = sourceText(path);
	const opening = text.search(/\bexport\s+const\s+actions\b[^=]*=\s*\{/);
	if (opening === -1) return {};

	const from = text.indexOf('{', opening);
	const entries = splitTopLevel(text.slice(from + 1)).map((segment) => {
		const named = /^\s*(\w+)\s*:/.exec(segment);
		if (!named) {
			throw new Error(
				`${path}: could not read a form action from ${JSON.stringify(segment.trim().slice(0, 80))}`
			);
		}
		return [named[1], segment] as const;
	});
	return Object.fromEntries(entries);
}

/**
 * Does the specifier `spec`, written inside the file `from`, refer to `module`?
 *
 * RESOLVED, not string-matched, and the reason is a basename collision that is easy to miss: there
 * are TWO `waitlist-funnel` modules — the server one this repo gates, and the client one holding the
 * event vocabulary. So `'./waitlist-funnel'` means the server module from inside `$lib/server` and
 * the CLIENT module from inside `$lib`. An earlier cut accepted the relative spelling wherever it
 * appeared, which would have reported a perfectly legal `import * as f from './waitlist-funnel'` in
 * `$lib` as a namespace import of the SERVER module — a false failure with a misleading message.
 *
 * Both spellings still have to count, because a file inside `$lib/server` reaches its neighbour
 * relatively and a rule that saw only the alias form would miss it entirely (mutation-proven).
 */
function refersTo(from: string, spec: string, module: string): boolean {
	if (spec === module) return true;
	if (!spec.startsWith('.')) return false;
	const target = module.startsWith('$lib/') ? `src/lib/${module.slice('$lib/'.length)}` : module;
	return normalize(join(dirname(from), spec)) === normalize(target);
}

/**
 * The names `path` binds from `module`, as EXPORTED — `{ a as b }` reports `a`, because an alias is
 * exactly how a banned import would otherwise slip a scan (mutation-proven).
 *
 * `export … from` counts too: re-exporting a binding hands it to the next file just as an import
 * does, so a rule that read only `import` could be walked past with one laundering module.
 *
 * BOTH QUOTE STYLES, deliberately, even though `prettier.config.js` sets `singleQuote` and
 * `prettier --check` is a required CI job. `.prettierignore` exempts several paths that are still
 * inside `src` and therefore still inside this scan, so single quotes are not actually universal
 * here — and a rule about who may call a function should not be resting on a formatter either way.
 *
 * Pinning the binding rather than call text is DAR-83's lesson: an ESM call site cannot exist without
 * it, so this catches the same mistake one step earlier, and unlike a call-text match it cannot be
 * tripped by prose that happens to name the function.
 */
export function importedNames(path: string, module: string): string[] {
	const bindings = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;
	return [...sourceText(path).matchAll(bindings)]
		.filter(([, , , spec]) => refersTo(path, spec, module))
		.flatMap(([, names]) => names.split(','))
		.map((name) =>
			name
				.trim()
				.replace(/^type\s+/, '')
				.split(/\s+as\s+/)[0]
				.trim()
		)
		.filter(Boolean);
}

/**
 * Does `path` reach `module` through `import * as ns` or `export * from`? Either binds every export
 * without naming one, which is how a name-based rule gets walked past.
 */
export const importsNamespace = (path: string, module: string): boolean =>
	[
		...sourceText(path).matchAll(
			/(?:import\s*\*\s*as\s+\w+|export\s*\*)\s*from\s*(['"])([^'"]+)\1/g
		)
	].some(([, , spec]) => refersTo(path, spec, module));

/**
 * Does `path` reach `module` through a DYNAMIC `import('…')`?
 *
 * The fifth walk-past route, after DAR-102's four (alias · namespace · re-export · relative
 * specifier). It needs its own check because `importedNames` parses the static form only, and a
 * dynamic import is not exotic in this repo — `scripts/gen-og.mjs` already lazy-loads that way, so
 * `const { send } = await import('…')` is the idiom someone would reach for without meaning to evade
 * anything. Measured during DAR-121: `email-senders.spec.ts` passed 7/7 against a marketing blast
 * that imported the mailer lazily.
 *
 * Matches TYPE-position `typeof import('…')` too, and that is the safe direction: no rule here is
 * about a module anyone has cause to name in a type query (`src/app.d.ts` does it for `auth`, which
 * no scan asks about), so a hit is worth a human look either way — loud and wrong beats silent.
 */
export const importsDynamically = (path: string, module: string): boolean =>
	[...sourceText(path).matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].some(([, , spec]) =>
		refersTo(path, spec, module)
	);
