// TEST SUPPORT — the waitlist's source surface, derived. Nothing in production imports this.
//
// Two specs enforce rules TypeScript cannot hold, and both do it by reading source: DAR-99's one
// signing secret (`waitlist-secret.spec.ts`) and DAR-83's honeypot gate on the funnel
// (`waitlist-funnel.spec.ts`). Each needs the same answer to "which files ARE the waitlist?", and
// that answer lives here once, because two copies of it is the drift both tickets exist to prevent —
// a spec whose surface definition has quietly fallen behind the other's reports a clean scan of the
// wrong set of files.
//
// WHY DERIVED AND NOT A PATH LIST. Measured during DAR-99, on the hand-written list this replaced:
// dropping one entry AND drifting that file in the same breath passed 7/7. A hand-written scan list
// has no failure mode that points at itself — deleting an entry makes the scan blind, silently. So
// the set comes from the directories, and the specs assert a FLOOR of known-critical paths instead,
// which fails loudly if the derivation ever matches nothing.
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
 * The waitlist lives in three places: its server modules, its remote modules, and its route.
 *
 * `src/routes/waitlist` is the waitlist by definition, so everything there counts; the two `$lib`
 * directories hold far more than the waitlist, so there the filename prefix is what scopes it.
 */
const DIRECTORIES = ['src/lib/server', 'src/lib', 'src/routes/waitlist'] as const;

const SOURCES: Record<string, string> = Object.fromEntries(
	DIRECTORIES.flatMap((dir) =>
		readdirSync(dir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.endsWith('.ts') &&
					// Specs are excluded deliberately, and it is the one exclusion: a fixture has no request
					// to resolve a secret from and no endpoint to gate, so writing either longhand is the
					// honest way to state it.
					!entry.name.includes('.spec.') &&
					!entry.name.includes('.e2e.') &&
					(dir === 'src/routes/waitlist' || entry.name.startsWith('waitlist'))
			)
			.map((entry) => [join(dir, entry.name), readFileSync(join(dir, entry.name), 'utf8')])
	)
);

/** Every waitlist source file, repo-relative. Vitest runs from the project root. */
export const waitlistSourcePaths = (): string[] => Object.keys(SOURCES);

/**
 * One file's source, with comments removed.
 *
 * Load-bearing. These files discuss the very names the specs scan for — "the STEP entry point, never
 * the bare `captureWaitlistFunnel`", "all four key off BETTER_AUTH_SECRET" — so a scan over raw text
 * would either trip on every explanation or be loosened until it stopped catching anything.
 * Stripping first is what lets the assertions be exact.
 *
 * Deliberately conservative: only WHOLE-LINE `//` comments go, so a trailing one naming a scanned
 * symbol fails its spec. That is the safe direction — loud and wrong beats silent and wrong — and it
 * is why this doesn't try to be clever about `//` inside string literals, where a URL would make it
 * eat real code and produce exactly the false PASS these specs exist to prevent.
 */
export const waitlistSource = (path: string): string =>
	SOURCES[path].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names `path` imports from `module`, as EXPORTED — `{ a as b }` reports `a`, because an alias
 * is exactly how a banned import would otherwise slip a scan.
 *
 * Pinning imports rather than call text is DAR-83's lesson: an ESM call site cannot exist without
 * the binding, so this catches the same mistake one step earlier, and unlike a call-text match it
 * cannot be tripped by prose that happens to name the function.
 */
export function waitlistImportedNames(path: string, module: string): string[] {
	const named = new RegExp(
		`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*'${escapeRe(module)}'`,
		'g'
	);
	return [...waitlistSource(path).matchAll(named)]
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
export const waitlistImportsNamespace = (path: string, module: string): boolean =>
	new RegExp(`import\\s*\\*\\s*as\\s+\\w+\\s*from\\s*'${escapeRe(module)}'`).test(
		waitlistSource(path)
	);
