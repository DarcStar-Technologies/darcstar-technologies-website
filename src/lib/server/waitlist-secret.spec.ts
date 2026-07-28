import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// DAR-99's backstop. The real guard is the type: every mint and verify across the flow's four signed
// values takes a `WaitlistSigningSecret`, so a call site that resolved its own key does not compile.
// But the brand is erased at runtime, so a cast defeats it — and the drift this exists to catch is
// exactly the kind someone reaches for a cast to get past ("just this one value needs its own key").
//
// So this pins the rest structurally: across the whole waitlist surface the env key may be NAMED in
// one file, the brand may be CAST INTO EXISTENCE in one file, and anything calling the resolver must
// import it by name. A second `readEnv` for the key at a step, or a new entry point resolving it for
// itself, fails here even when it type-checks.
//
// It reads source rather than behaviour because there is no behaviour to read: a mismatched secret
// does not throw, it verifies to `null`, and every caller treats null as "this feature is off". Same
// reason `waitlist-funnel.spec.ts` reads `waitlist-steps.remote.ts` for DAR-83's honeypot gate.

/**
 * The surface, DERIVED — every non-spec source file in the waitlist's three homes.
 *
 * A hand-written path list was the first cut, and it had the defect every hand-written path list has:
 * deleting an entry makes the scan blind to that file while the suite stays green. Measured rather
 * than assumed — dropping `waitlist-steps.remote.ts` from the list and drifting it in the same breath
 * passed 7/7. Deriving removes the entry there is to delete, and a new waitlist module is covered the
 * day it lands rather than the day someone remembers. (`message-catalogs.spec.ts` derives its
 * catalogs the same way, for the same reason.)
 *
 * Read through `node:fs` rather than `import.meta.glob`, which is the idiom elsewhere: a raw glob asks
 * Vite to load `.remote.ts` files and SvelteKit's remote-module plugin refuses them ("Cannot export
 * `default` from a remote module"). Those four files are most of the point, so the reader has to be
 * one that treats them as text.
 *
 * Specs are excluded deliberately, and it is the one exclusion: a fixture has no request to resolve a
 * secret from, so casting one is the honest way to state it.
 */
const DIRECTORIES = ['src/lib/server', 'src/lib', 'src/routes/waitlist'] as const;

const SOURCES: Record<string, string> = Object.fromEntries(
	DIRECTORIES.flatMap((dir) =>
		readdirSync(dir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.endsWith('.ts') &&
					!entry.name.includes('.spec.') &&
					!entry.name.includes('.e2e.') &&
					// `src/routes/waitlist` is the waitlist by definition; the two `$lib` directories hold
					// far more than it, so there the filename prefix is what scopes the scan.
					(dir === 'src/routes/waitlist' || entry.name.startsWith('waitlist'))
			)
			.map((entry) => [join(dir, entry.name), readFileSync(join(dir, entry.name), 'utf8')])
	)
);

/** The one file allowed to name the key and to mint the brand. */
const RESOLVER = 'src/lib/server/waitlist-secret.ts';

/**
 * Source with comments removed.
 *
 * Load-bearing, and it is DAR-83's lesson in a new place: these files discuss `BETTER_AUTH_SECRET` in
 * prose constantly ("all four key off BETTER_AUTH_SECRET"), so a scan over raw text would either trip
 * on every explanation or be loosened until it stopped catching anything. Stripping first lets the
 * assertion be exact.
 *
 * Deliberately conservative: only WHOLE-LINE `//` comments go, so a trailing one naming the key would
 * fail this spec. That is the safe direction — loud and wrong beats silent and wrong — and it is why
 * the stripper doesn't try to be clever about `//` inside string literals, where a URL would make it
 * eat real code and produce the false PASS this whole file exists to prevent.
 */
const code = (path: string): string =>
	SOURCES[path].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const paths = () => Object.keys(SOURCES);

describe('the waitlist signing secret has one resolver (DAR-99)', () => {
	// The env key, assembled so this file's own text cannot satisfy the scan it performs.
	const KEY = ['BETTER', 'AUTH', 'SECRET'].join('_');

	// A derivation that matched nothing would make every assertion below vacuously true, which is how
	// a derived list fails. Pin the files that must be in it: the resolver, the four modules that mint
	// or verify, and the four request entry points.
	it('found the surface it is supposed to be scanning', () => {
		for (const required of [
			RESOLVER,
			'src/lib/server/waitlist-token.ts',
			'src/lib/server/waitlist-flow.ts',
			'src/lib/server/waitlist-resume.ts',
			'src/lib/server/waitlist-funnel.ts',
			'src/lib/waitlist.remote.ts',
			'src/lib/waitlist-steps.remote.ts',
			'src/lib/waitlist-funnel.remote.ts',
			'src/routes/waitlist/+page.server.ts'
		]) {
			expect(paths()).toContain(required);
		}
	});

	it('names the env key in exactly one file across the whole surface', () => {
		expect(paths().filter((path) => code(path).includes(KEY))).toEqual([RESOLVER]);
	});

	// THE CAST ROUTE, which the assertion above leaves open. Naming a DIFFERENT key —
	// `readEnv('WAITLIST_FUNNEL_SECRET') as WaitlistSigningSecret` — never mentions this key and
	// satisfies the compiler, because that is what a cast is for. What it cannot do is avoid writing
	// the cast, so the brand is minted in one place exactly as the flow id is.
	it('mints the brand in exactly one file', () => {
		expect(paths().filter((path) => /\bas\s+WaitlistSigningSecret\b/.test(code(path)))).toEqual([
			RESOLVER
		]);
	});

	// The resolver must read the key Better Auth signs sessions with — that reuse is why there is no
	// second secret to provision, and the domain separation inside `mintSignedValue` is what makes
	// sharing it safe. Repointing this elsewhere would keep the four values consistent with each other
	// while quietly ending the reuse, so it should be a deliberate edit rather than a rename.
	it('resolves that key through readEnv', () => {
		expect(code(RESOLVER)).toContain(`readEnv('${KEY}')`);
	});

	// Anything reaching for the secret must bind the resolver by name. Pinning the IMPORT rather than
	// the call text is DAR-83's lesson: a binding cannot exist without something to bind, while a
	// call-text match can be tripped by a comment. Namespace imports are blocked for the same reason.
	it('makes every caller import the resolver by name', () => {
		const callers = paths().filter(
			(path) => path !== RESOLVER && code(path).includes('waitlistSigningSecret(')
		);
		expect(callers.length).toBeGreaterThanOrEqual(4);

		for (const path of callers) {
			expect(
				/import\s*\{[^}]*\bwaitlistSigningSecret\b[^}]*\}\s*from\s*'\$lib\/server\/waitlist-secret'/.test(
					code(path)
				),
				`${path} calls the resolver without importing it by name`
			).toBe(true);
			expect(
				/import\s*\*\s*as\s+\w+\s*from\s*'\$lib\/server\/waitlist-secret'/.test(code(path)),
				`${path} reaches the resolver through a namespace import`
			).toBe(false);
		}
	});
});
