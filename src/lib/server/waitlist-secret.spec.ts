import { describe, expect, it } from 'vitest';
import {
	waitlistImportedNames,
	waitlistImportsNamespace,
	waitlistSource,
	waitlistSourcePaths
} from './waitlist-source-scan';

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
// reason `waitlist-funnel.spec.ts` scans for DAR-83's honeypot gate.
//
// The surface is DERIVED, not hand-listed, and `waitlist-source-scan.ts` carries the measurement
// behind that (a hand-written list went blind to a drifted file and passed 7/7).

/** The one file allowed to name the key and to mint the brand. */
const RESOLVER = 'src/lib/server/waitlist-secret.ts';

const RESOLVER_MODULE = '$lib/server/waitlist-secret';

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
			expect(waitlistSourcePaths()).toContain(required);
		}
	});

	it('names the env key in exactly one file across the whole surface', () => {
		expect(waitlistSourcePaths().filter((path) => waitlistSource(path).includes(KEY))).toEqual([
			RESOLVER
		]);
	});

	// THE CAST ROUTE, which the assertion above leaves open. Naming a DIFFERENT key —
	// `readEnv('WAITLIST_FUNNEL_SECRET') as WaitlistSigningSecret` — never mentions this key and
	// satisfies the compiler, because that is what a cast is for. What it cannot do is avoid writing
	// the cast, so the brand is minted in one place exactly as the flow id is.
	it('mints the brand in exactly one file', () => {
		expect(
			waitlistSourcePaths().filter((path) =>
				/\bas\s+WaitlistSigningSecret\b/.test(waitlistSource(path))
			)
		).toEqual([RESOLVER]);
	});

	// The resolver must read the key Better Auth signs sessions with — that reuse is why there is no
	// second secret to provision, and the domain separation inside `mintSignedValue` is what makes
	// sharing it safe. Repointing this elsewhere would keep the four values consistent with each other
	// while quietly ending the reuse, so it should be a deliberate edit rather than a rename.
	it('resolves that key through readEnv', () => {
		expect(waitlistSource(RESOLVER)).toContain(`readEnv('${KEY}')`);
	});

	// Anything reaching for the secret must bind the resolver by name; a namespace import would reach
	// it without naming it.
	it('makes every caller import the resolver by name', () => {
		const callers = waitlistSourcePaths().filter(
			(path) => path !== RESOLVER && waitlistSource(path).includes('waitlistSigningSecret(')
		);
		expect(callers.length).toBeGreaterThanOrEqual(4);

		for (const path of callers) {
			expect(
				waitlistImportedNames(path, RESOLVER_MODULE),
				`${path} calls the resolver without importing it by name`
			).toContain('waitlistSigningSecret');
			expect(
				waitlistImportsNamespace(path, RESOLVER_MODULE),
				`${path} reaches the resolver through a namespace import`
			).toBe(false);
		}
	});
});
