import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// DAR-99's backstop. The real guard is the type: every mint and verify across the flow's four signed
// values takes a `WaitlistSigningSecret`, so a call site that resolved its own key does not compile.
// But the brand is erased at runtime, so a cast defeats it — and the drift this exists to catch is
// exactly the kind someone reaches for a cast to get past ("just this one value needs its own key").
//
// So this pins the other half structurally: across the whole waitlist surface, the env key may be
// NAMED as a resolver argument in one file. Anything else — a second `readEnv` for it at a step, a new
// entry point resolving it for itself — fails here even if it type-checks.
//
// It reads source rather than behaviour because there is no behaviour to read: a mismatched secret
// does not throw, it verifies to `null`, and every caller treats null as "this feature is off". Same
// reason `waitlist-funnel.spec.ts` reads `waitlist-steps.remote.ts` for DAR-83's honeypot gate.

/** Every file that mints, verifies, or resolves one of the flow's signed values. */
const WAITLIST_SURFACE = [
	'src/lib/server/waitlist-secret.ts',
	'src/lib/server/waitlist-token.ts',
	'src/lib/server/waitlist-flow.ts',
	'src/lib/server/waitlist-resume.ts',
	'src/lib/server/waitlist-funnel.ts',
	'src/lib/waitlist.remote.ts',
	'src/lib/waitlist-steps.remote.ts',
	'src/lib/waitlist-funnel.remote.ts',
	'src/routes/waitlist/+page.server.ts'
] as const;

/** The one file allowed to name the key. */
const RESOLVER = 'src/lib/server/waitlist-secret.ts';

/**
 * Source with comments removed.
 *
 * Load-bearing, and DAR-83 learned it the hard way: these files discuss `BETTER_AUTH_SECRET` in prose
 * constantly ("all four key off BETTER_AUTH_SECRET"), so a scan over raw text would either trip on
 * every explanation or have to be loosened until it stopped catching anything. Stripping first lets
 * the assertion be exact.
 */
const code = (path: string): string =>
	readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');

describe('the waitlist signing secret has one resolver (DAR-99)', () => {
	// The env key, spelled so this file's own text can't satisfy the scan it performs.
	const KEY = ['BETTER', 'AUTH', 'SECRET'].join('_');

	it('is named in exactly one file across the whole surface', () => {
		const naming = WAITLIST_SURFACE.filter((path) => code(path).includes(KEY));
		expect(naming).toEqual([RESOLVER]);
	});

	// The resolver has to read the key Better Auth signs sessions with — that reuse is the reason
	// there is no second secret to provision, and the domain separation inside `mintSignedValue` is
	// what makes sharing it safe. Repointing it elsewhere would keep the four values consistent with
	// each other while quietly ending the reuse, so it should be a deliberate edit, not a rename.
	it('resolves that key through readEnv', () => {
		expect(code(RESOLVER)).toContain(`readEnv('${KEY}')`);
	});

	// Every entry point must reach the secret through the resolver. Pinning the IMPORT rather than the
	// call text is DAR-83's lesson: a call-text match can be tripped by a comment, and a binding cannot
	// exist without something to bind. Namespace imports are blocked for the same reason.
	it.each(
		WAITLIST_SURFACE.filter(
			(path) => path.endsWith('.remote.ts') || path.endsWith('+page.server.ts')
		)
	)('%s imports the resolver rather than resolving for itself', (path) => {
		const src = code(path);
		expect(src).toMatch(
			/import\s*\{[^}]*\bwaitlistSigningSecret\b[^}]*\}\s*from\s*'\$lib\/server\/waitlist-secret'/
		);
		expect(src).not.toMatch(/import\s*\*\s*as\s+\w+\s*from\s*'\$lib\/server\/waitlist-secret'/);
	});

	// THE CAST ROUTE, which is the one the other two assertions leave open. Naming a DIFFERENT key —
	// `readEnv('WAITLIST_FUNNEL_SECRET') as WaitlistSigningSecret` — passes the scan above (it never
	// mentions this key) and satisfies the compiler (that is what a cast is for). What it cannot do is
	// avoid writing the cast, so the brand must be MINTED in one place just as the flow id is: the
	// resolver is the only file allowed to assert something is a signing secret.
	//
	// Specs are exempt by construction — they are not on the surface list, and a fixture has no
	// request to resolve from, so casting is the honest way for one to state a secret.
	it('is cast into existence only by the resolver', () => {
		const casting = WAITLIST_SURFACE.filter((path) =>
			/\bas\s+WaitlistSigningSecret\b/.test(code(path))
		);
		expect(casting).toEqual([RESOLVER]);
	});

	// The scan is only worth anything if it would notice. A surface file that no longer exists — a
	// rename, a move — must fail loudly here rather than silently stop being checked, which is the
	// failure mode every path-list-based test has.
	it('checks files that actually exist', () => {
		for (const path of WAITLIST_SURFACE) expect(code(path).length).toBeGreaterThan(0);
	});
});
