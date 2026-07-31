import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as styles from './styles';
import { classLiterals, markupSourcePaths, markupText } from './server/source-scan';

// DAR-218. `$lib/styles.ts` exists so a form control that renders its own label can't drift from one
// that delegates — and five of its strings had been re-typed verbatim at call sites anyway, four of
// them in files that ALREADY imported from it. Nothing could see that: the module has no consumer
// list, so a hand-written copy is indistinguishable from a route that simply never needed it.
//
// The rule is a SUPERSET test, not equality: a call site that adds `mt-2` to a copy is the same
// defect one token further from the original, and it is the shape drift actually takes.
//
// It reads the module by IMPORTING it rather than parsing the source, which matters more than it
// looks — `fieldLabelClass` is composed from a shared const via a template literal, and a regex over
// the source would have to be taught that. Importing asks the module what it exports, so a future
// refactor of how the strings are BUILT can never quietly narrow what this scans.

/** The exported class strings, as `name → tokens`. Non-string exports (if any are added) drop out. */
const SHARED = Object.entries(styles)
	.filter(([, value]) => typeof value === 'string')
	.map(([name, value]) => [name, (value as string).split(/\s+/).filter(Boolean)] as const);

// Every entry is a REASON, and the polarity is what makes a hand-written list safe here (DAR-102):
// deleting one makes the rule STRICTER, so the edit that would blind this scan fails it instead. The
// paired assertion below covers the other direction — an entry whose call site is gone fails too, so
// the list can't rot into names nobody checks.
//
// Empty on purpose right now. It is kept, with its polarity documented, because the honest thing to
// record is that no legitimate exception has turned up yet — not that none can.
const ALLOWED: { file: string; token: string; why: string }[] = [];

const violations = () =>
	markupSourcePaths().flatMap((file) =>
		classLiterals(file).flatMap((tokens) => {
			const set = new Set(tokens);
			return SHARED.filter(([, shared]) => shared.every((t) => set.has(t))).map(([name]) => ({
				file,
				name,
				tokens: tokens.join(' ')
			}));
		})
	);

describe('shared class strings are imported, never re-typed', () => {
	// The scan is only worth what its reach is, and "nothing matched" reads identically to "the
	// scanner looked at nothing" (DAR-152's lesson, and DAR-171's). So reach is measured directly
	// rather than inferred from a clean result.
	it('reaches every component in the tree', () => {
		const files = markupSourcePaths();
		// Floors, not exact counts — the tree grows. Measured at 84 files / 817 literals, so these
		// have real headroom while still failing loudly if the read stops finding most of the tree.
		expect(files.length).toBeGreaterThan(70);
		expect(files).toContain('src/routes/waitlist/+page.svelte');
		expect(files).toContain('src/lib/components/GlassSelect.svelte');
		// A route nested three deep, so a non-recursive read can't pass this.
		expect(files).toContain('src/routes/admin/users/[id]/+page.svelte');
		expect(files.flatMap(classLiterals).length).toBeGreaterThan(600);
	});

	// The detector needs positive cases of its own, or every assertion here is "nothing matched" and
	// a scanner that answers nothing satisfies all of them.
	//
	// The SUPERSET case is the one that matters and the one easiest to write vacuously: an earlier
	// cut of this test built the extended set and then asserted against the plain one twice, so it
	// passed while testing nothing. Both cases are spelled out through the same helper the rule uses.
	const matches = (tokens: string[]) =>
		SHARED.filter(([, shared]) => shared.every((t) => new Set(tokens).has(t))).map(([n]) => n);

	it('detects a verbatim re-typing', () => {
		expect(matches(styles.fieldLabelClass.split(/\s+/))).toContain('fieldLabelClass');
	});

	it('detects a re-typing that adds tokens', () => {
		expect(matches([...styles.fieldLabelClass.split(/\s+/), 'mt-2'])).toContain('fieldLabelClass');
	});

	// The other direction: a class that merely shares SOME tokens is not a copy, or the rule would
	// fire on every element that happens to be `text-xs` and get loosened until it caught nothing.
	it('does not fire on a partial overlap', () => {
		expect(matches(['mb-1.5', 'flex', 'text-xs', 'text-body'])).toStrictEqual([]);
	});

	it('finds no re-typed shared string in any component', () => {
		const unexplained = violations().filter(
			(v) => !ALLOWED.some((a) => a.file === v.file && a.token === v.name)
		);
		expect(
			unexplained.map((v) => `${v.file} re-types ${v.name}: class="${v.tokens}"`)
		).toStrictEqual([]);
	});

	// The rot direction. An allowlist entry whose call site was fixed (or deleted) stops describing
	// anything, and a list of names nobody checks is how an exception list becomes decoration.
	it('has no stale allowlist entry', () => {
		const live = violations();
		expect(
			ALLOWED.filter((a) => !live.some((v) => v.file === a.file && v.name === a.token)).map(
				(a) => `${a.file} no longer re-types ${a.token} — drop this entry`
			)
		).toStrictEqual([]);
	});

	// Every exported string must have at least one consumer. Without this the module can accumulate
	// strings nothing uses, and an unused export is a string the next author copies rather than
	// imports, because it does not look load-bearing.
	it('exports nothing unused', () => {
		const importers = markupSourcePaths()
			.map((f) => readFileSync(f, 'utf8'))
			.join('\n');
		expect(SHARED.map(([name]) => name).filter((name) => !importers.includes(name))).toStrictEqual(
			[]
		);
	});
});

describe('the eyebrow base is a composition root, not a call-site class', () => {
	// `eyebrow` had 22 call sites in exactly three size/tracking combinations, two of them arbitrary
	// bracket values hand-typed 11 and 3 times. Naming the tiers only helps while nobody re-opens the
	// bracket, and the bare base is how that would happen: `class="eyebrow text-xs tracking-[0.25em]"`
	// still renders correctly, so nothing but this would report it.
	it('is never used bare in markup', () => {
		const bare = markupSourcePaths().flatMap((file) =>
			classLiterals(file)
				.filter((tokens) => tokens.includes('eyebrow'))
				.map((tokens) => `${file}: class="${tokens.join(' ')}"`)
		);
		expect(bare).toStrictEqual([]);
	});

	// Every eyebrow token in markup is one of the three tiers, and every tier is actually defined.
	// The second half is what a set-equality check alone would miss: a typo'd tier fails the equality
	// (it lands in `used`), but a tier RENAMED in both markup and this list would still pass while
	// resolving to no CSS at all, since an unknown class renders silently.
	it('uses only tiers that layout.css defines', () => {
		const css = readFileSync('src/routes/layout.css', 'utf8');
		const used = [
			...new Set(
				markupSourcePaths().flatMap((file) =>
					classLiterals(file)
						.flat()
						.filter((t) => t.startsWith('eyebrow'))
				)
			)
		].sort();
		expect(used).toStrictEqual(['eyebrow-hero', 'eyebrow-label', 'eyebrow-panel']);
		expect(used.filter((tier) => !css.includes(`@utility ${tier} {`))).toStrictEqual([]);
	});
});

describe('the hero helix geometry has one source', () => {
	// CosmicBackdrop MEASURES `#helix-slot` and caps the helix amplitude at 42% of its height, so a
	// re-typed slot height does not clip the helix — it silently shrinks it, which is the kind of
	// regression that survives review because the page still looks deliberate.
	const css = readFileSync('src/routes/layout.css', 'utf8');

	it('defines both tokens exactly once', () => {
		expect(css.match(/--helix-slot-h:/g)).toHaveLength(1);
		expect(css.match(/--helix-pull:/g)).toHaveLength(1);
	});

	it('is never re-typed as a literal in markup', () => {
		const literals = markupSourcePaths().filter((file) => /min\(\s*2[35]vw/.test(markupText(file)));
		expect(literals).toStrictEqual([]);
	});

	// Stronger than "no literal appears", because that passes against a slot sized some other way
	// entirely. Anything rendering the element CosmicBackdrop measures has to take its height from
	// the token — there are two such files (PageHero and the homepage, which composes its own hero
	// deliberately) and both must, so the count is asserted rather than just the property.
	it('sizes every helix slot from the token', () => {
		const slots = markupSourcePaths().filter((file) =>
			markupText(file).includes('id="helix-slot"')
		);
		expect(slots).toHaveLength(2);
		expect(slots.filter((f) => !markupText(f).includes('var(--helix-slot-h)'))).toStrictEqual([]);
	});

	// The pull must stay UNDER the slot height or the panel over-pulls past the eyebrow above it.
	// Stated as the relationship rather than as the numbers, so re-tuning the hero carries it along.
	it('pulls the panel up by less than the slot height', () => {
		const val = (name: string) =>
			[...css.matchAll(new RegExp(`--${name}:\\s*min\\(([\\d.]+)vw,\\s*([\\d.]+)rem\\)`, 'g'))][0];
		const slot = val('helix-slot-h');
		const pull = val('helix-pull');
		expect(slot).toBeDefined();
		expect(pull).toBeDefined();
		expect(Number(pull[1])).toBeLessThan(Number(slot[1]));
		expect(Number(pull[2])).toBeLessThan(Number(slot[2]));
	});
});
