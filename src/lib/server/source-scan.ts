// TEST SUPPORT — source sets for the specs that enforce rules TypeScript cannot hold. Nothing in
// production imports this.
//
// Two of those specs read source: DAR-99's one signing secret (`waitlist-secret.spec.ts`) and
// DAR-83's honeypot gate on the funnel (`waitlist-funnel.spec.ts`). The reading, comment-stripping
// and import-parsing live here once, because two copies of them is the drift both tickets exist to
// prevent.
//
// THE TWO SURFACES ARE NOT THE SAME SET, and that is deliberate rather than an oversight:
//
//   - `appSourcePaths()` — everything under `src`. The funnel gate needs this, because the question
//     it asks ("who imports the ungated capture function?") has no reason to stop at a directory
//     boundary. Scoping it to the waitlist's own folders is exactly the DAR-102 defect one level up:
//     a step endpoint added under `src/routes/waitlist/step5/` or `src/routes/api/` would escape.
//   - `waitlistSourcePaths()` — the waitlist's own modules. The secret rule needs this NARROWER set,
//     because `auth.ts` legitimately names the signing key (it is Better Auth's own), so "named in
//     exactly one file" is only ever true of the waitlist.
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
import { join } from 'node:path';

/**
 * Every non-spec TypeScript file under `src`, RECURSIVELY, as `path → source`.
 *
 * Recursive is load-bearing, not tidiness: a flat read was measured to pass 56/56 against a
 * token-gated step planted in `src/routes/waitlist/step5/+page.server.ts` — DAR-102's own failure
 * mode, one directory deeper than the fix meant to close it.
 *
 * Specs are excluded, and it is the one exclusion: a fixture has no request to resolve a secret from
 * and no endpoint to gate, so writing either longhand is the honest way to state it.
 */
const SOURCES: Record<string, string> = Object.fromEntries(
	readdirSync('src', { withFileTypes: true, recursive: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith('.ts') &&
				!entry.name.includes('.spec.') &&
				!entry.name.includes('.test.') &&
				!entry.name.includes('.e2e.')
		)
		.map((entry): [string, string] => {
			const path = join(entry.parentPath, entry.name);
			return [path, readFileSync(path, 'utf8')];
		})
);

/** Every non-spec source file under `src`, repo-relative. Vitest runs from the project root. */
export const appSourcePaths = (): string[] => Object.keys(SOURCES);

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

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Both spellings of a module specifier. A file inside `$lib/server` reaches its neighbour relatively,
 * so `'$lib/server/waitlist-funnel'` and `'./waitlist-funnel'` are the same import — a rule that saw
 * only one of them would report "you never imported this" at a file that plainly did.
 */
const specifiers = (module: string): string =>
	[module, `./${module.slice(module.lastIndexOf('/') + 1)}`].map(escapeRe).join('|');

/**
 * The names `path` imports from `module`, as EXPORTED — `{ a as b }` reports `a`, because an alias
 * is exactly how a banned import would otherwise slip a scan (mutation-proven).
 *
 * Pinning imports rather than call text is DAR-83's lesson: an ESM call site cannot exist without
 * the binding, so this catches the same mistake one step earlier, and unlike a call-text match it
 * cannot be tripped by prose that happens to name the function.
 */
export function importedNames(path: string, module: string): string[] {
	const named = new RegExp(
		`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*'(?:${specifiers(module)})'`,
		'g'
	);
	return [...sourceText(path).matchAll(named)]
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

/** Does `path` reach `module` through `import * as ns`? That binds every export without naming one. */
export const importsNamespace = (path: string, module: string): boolean =>
	new RegExp(`import\\s*\\*\\s*as\\s+\\w+\\s*from\\s*'(?:${specifiers(module)})'`).test(
		sourceText(path)
	);
