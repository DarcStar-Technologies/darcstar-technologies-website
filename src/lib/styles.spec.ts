import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as styles from './styles';
import {
	classLiterals,
	markupSourcePaths,
	markupText,
	MARKUP_STRIP_PATTERNS,
	stripToFixedPoint
} from './server/source-scan';

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

// The instrument this whole file rests on. Pinned separately because every assertion below is a
// statement about what the scan FOUND, and all of them stay green if the reader silently hands back
// the wrong text — a script body read as markup turns its class-name mentions into violations, which
// is a false FAILURE, the one direction a guard must never produce.
describe('the markup reader', () => {
	// The fixed-point property, stated WITHOUT HTML. It is not an HTML property: it holds for any
	// pattern whose removal can splice the surrounding text into a fresh match, and `ab` inside `aabb`
	// is the smallest thing that shows it. Same defect DAR-173 found in its brace-stripper.
	//
	// Writing it this way is also what keeps CodeQL's `js/incomplete-multi-character-sanitization` off
	// a file whose whole job is to demonstrate that very defect — a faithful HTML demonstration has to
	// CONTAIN the vulnerable call, so the alert was unavoidable and the suppression would have been
	// permanent. The abstract form proves the same thing and has nothing to suppress.
	it('strips a delimiter reconstructed by its own removal', () => {
		// One pass leaves a match that only exists BECAUSE of the removal.
		expect('aabb'.replace(/ab/g, '')).toBe('ab');
		expect(stripToFixedPoint('aabb', /ab/g)).toBe('');
		// Asserting the single-pass result is what makes the loop demonstrably load-bearing rather
		// than merely present. A first cut of this test got its expected output wrong by reasoning
		// instead of measuring, which is the other reason the case is now this small.
	});

	it('terminates when there is nothing to strip', () => {
		expect(stripToFixedPoint('nothing to see', /ab/g)).toBe('nothing to see');
	});

	// The HTML cases go through the REAL pattern rather than a copy, which is mutation-measured: with
	// a local copy here, deleting the `i` flag from the shipped one left all 17 tests green, because
	// this test then pinned the helper and said nothing about its caller (DAR-171).
	//
	// `<SCRIPT>` is unreachable via Svelte, which rejects it, and so is `</script bar>` — but a
	// stripper exhaustive only for input it assumes well-formed is DAR-102's shape. The end-tag case
	// is the one CodeQL's `js/bad-tag-filter` names, and it is real HTML: an end tag's attributes are
	// a parse error the parser ignores, not a reason to leave the element open.
	it('strips a script block whatever its case, spacing or end-tag junk', () => {
		const [script] = MARKUP_STRIP_PATTERNS;
		expect(stripToFixedPoint('a<SCRIPT>let c = "p-4";</SCRIPT>b', script)).toBe('ab');
		expect(stripToFixedPoint('a<script>x</script  >b', script)).toBe('ab');
		expect(stripToFixedPoint('a<script>x</script bar>b', script)).toBe('ab');
	});

	// The reconstruction hazard in the shape that actually reaches this repo, through the real
	// pattern: one pass would leave `b` — genuine script body — in what the caller treats as markup.
	it('removes a script block that its own removal reconstructs', () => {
		const [script] = MARKUP_STRIP_PATTERNS;
		expect(stripToFixedPoint('<scr<script>a</script>ipt>b</script>c', script)).toBe('c');
	});

	// The reason the script is stripped at all: a component that correctly IMPORTS a shared string
	// names it, and reading that name as markup would report the fixed call site as a violation.
	it('hides script-side mentions of a shared string from the scan', () => {
		const text = markupText('src/routes/waitlist/+page.svelte');
		expect(text).not.toContain('import');
		expect(text).toContain('class=');
	});
});

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

	// --- The subset direction (DAR-219) ------------------------------------------------------------
	//
	// The superset rule above is blind to a variant that carries the treatment and differs in the
	// LAYOUT around it, and that blindness was not hypothetical: DAR-218 shipped this file, documented
	// the hole for the one case it fixed (`fieldLegendRowClass`, a subset of `fieldLabelClass`), and a
	// SECOND subset sat beside it at 17 sites across 7 files — `mb-1.5 block …` instead of the flex
	// row — in files that imported `fieldClass` and hand-typed the label next to it. Three times the
	// re-typings the original ticket found, invisible to every assertion here.
	//
	// So the rule is derived rather than restated (DAR-99): where two exports overlap substantially,
	// the overlap IS the idiom, and a literal carrying the whole overlap is wearing it — whether it
	// adds tokens (caught above) or drops them (caught here). Deriving means a future export brings
	// its own cores along, and no core can be forgotten because none is written down.
	const MIN_CORE = 3;

	/** Token groups shared by two or more exports — the drift-prone core of each idiom. */
	const CORES = SHARED.flatMap(([aName, a], i) =>
		SHARED.slice(i + 1).flatMap(([bName, b]) => {
			const core = a.filter((t) => b.includes(t));
			return core.length >= MIN_CORE ? [{ pair: `${aName} + ${bName}`, core }] : [];
		})
	);

	const carriers = () =>
		markupSourcePaths().flatMap((file) =>
			classLiterals(file).flatMap((tokens) => {
				const set = new Set(tokens);
				return CORES.filter(({ core }) => core.every((t) => set.has(t))).map(
					({ pair }) => `${file} hand-writes the core of ${pair}: class="${tokens.join(' ')}"`
				);
			})
		);

	// The derivation is the instrument, so it gets a positive control: an empty CORES list makes every
	// assertion below pass while checking nothing (DAR-152's blind-scan shape).
	it('derives the label ink as a shared core', () => {
		expect(CORES.length).toBeGreaterThan(0);
		expect(CORES.map(({ core }) => [...core].sort().join(' '))).toContain(
			'font-medium text-body text-xs tracking-wide'
		);
	});

	it('detects a variant that drops tokens from a shared string', () => {
		// DAR-219's own shape — the ink, re-boxed — but NOT its string, which is now `fieldLabelBlock-
		// Class` and so is visible to the superset rule again. That is the fix working, and it is also
		// why this case has to be the NEXT variant rather than the one just closed: a test written
		// against the historical string would assert that the export exists, not that the rule holds.
		const variant = 'mb-1.5 inline-flex text-xs font-medium tracking-wide text-body'.split(/\s+/);
		// Invisible to the superset rule: it is a superset of no export.
		expect(matches(variant)).toStrictEqual([]);
		// Visible to this one, because it carries the whole ink.
		const set = new Set(variant);
		expect(CORES.filter(({ core }) => core.every((t) => set.has(t))).length).toBeGreaterThan(0);
	});

	// `MIN_CORE` is a choice inside a MEASURED empty band, not a number tuned until the suite passed.
	// Today's pairs overlap in 2 tokens (`w-full text-sm`, `mb-1.5 text-xs` — incidental collisions
	// between unrelated idioms) or in 4+ (the label ink and its flex row). Nothing lands on 3, so the
	// floor can sit anywhere in (2, 4] without changing a single result — and the two cases below
	// bracket it, so a later move OUT of that band fails rather than silently widening or blinding it.
	it('brackets the core floor against incidental overlap', () => {
		const sizes = CORES.map(({ core }) => core.length);
		expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_CORE);
		// Below the band: two tokens two unrelated exports happen to share is not an idiom.
		expect(MIN_CORE).toBeGreaterThan(2);
		// Above it: a floor past the real ink (4 tokens) would stop seeing the defect this exists for.
		expect(MIN_CORE).toBeLessThanOrEqual(4);
	});

	// No allowlist, deliberately, and the reason is that a carrier is always fixable by importing —
	// unlike DAR-102's scans, where an exemption names a file that legitimately does the thing. If one
	// ever turns out to be genuinely unfixable, add a list here with that ticket's polarity (an entry
	// makes the rule stricter to delete) rather than raising MIN_CORE, which blinds it everywhere.
	it('finds no hand-written variant of a shared string', () => {
		expect(carriers()).toStrictEqual([]);
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

describe('the pill button base is a composition root, not a call-site class', () => {
	// Same shape as the eyebrow above, and found the same way (DAR-219): `btn-pill` looked like one
	// utility with two documented one-offs beside it, and measured out as three fixed size tiers —
	// four buttons on one combination, two on another, none of them varying. The base holds shape and
	// ink; a bare `btn-pill-base` renders a pill with no padding, which nothing means to do.
	const css = readFileSync('src/routes/layout.css', 'utf8');

	it('is never used bare in markup', () => {
		const bare = markupSourcePaths().flatMap((file) =>
			classLiterals(file)
				.filter((tokens) => tokens.includes('btn-pill-base'))
				.map((tokens) => `${file}: class="${tokens.join(' ')}"`)
		);
		expect(bare).toStrictEqual([]);
	});

	// Skeleton ships its own `btn-*` component classes, so the namespace is shared and "every btn- in
	// markup is ours" would be false. Naming the one we borrow is what keeps that distinction visible:
	// a NEW Skeleton button class appearing in markup should be a decision someone makes on purpose,
	// not something that slips in beside our tiers because both start with `btn-`.
	const SKELETON_BUTTONS = ['btn-icon'];

	// The definition half is what set-equality alone would miss — a tier renamed in BOTH markup and
	// this list still passes while resolving to no CSS at all, since an unknown class renders silently.
	it('uses only tiers that layout.css defines', () => {
		const used = [
			...new Set(
				markupSourcePaths().flatMap((file) =>
					classLiterals(file)
						.flat()
						.filter((t) => t.startsWith('btn-'))
				)
			)
		].sort();
		expect(used).toStrictEqual([
			'btn-danger',
			'btn-icon',
			'btn-pill',
			'btn-pill-sm',
			'btn-pill-xs'
		]);
		expect(
			used.filter((t) => !SKELETON_BUTTONS.includes(t) && !css.includes(`@utility ${t} {`))
		).toStrictEqual([]);
		// And the borrowed ones really are borrowed — if `btn-icon` ever gains a local definition, this
		// list has stopped describing what it claims to.
		expect(SKELETON_BUTTONS.filter((t) => css.includes(`@utility ${t} {`))).toStrictEqual([]);
	});

	// Every white pill must take its shape from a tier. Stated over the MARKUP rather than as "the
	// literal is gone", because that passes against a seventh button that spells the same pill with
	// `rounded-[9999px]` — the drift this family exists to stop, one synonym further out.
	it('leaves no hand-rolled pill beside the tiers', () => {
		const handRolled = markupSourcePaths().flatMap((file) =>
			classLiterals(file)
				.filter(
					(t) => t.includes('rounded-full') && t.includes('font-medium') && t.includes('px-4')
				)
				.map((t) => `${file}: class="${t.join(' ')}"`)
		);
		// The two survivors are `/admin/users/[id]`'s danger zone — an outline pill and a filled
		// outline pill, one use each, whose difference IS the disable-then-delete escalation. Naming
		// them would collapse a severity distinction into a shared token.
		expect(handRolled).toHaveLength(2);
		expect(handRolled.filter((s) => !s.includes('error-500'))).toStrictEqual([]);
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
