// Detects the one figure the evidence surface must never publish: the size of the theorem
// catalog (equivalently, the not-yet-mechanized remainder — same secret, complemented). Shared
// by evidence-boundary.spec.ts (which scans the message catalogs + the $lib/evidence constants)
// and the evidence e2e (which scans rendered page text), so a route closed here closes on both
// surfaces at once — a hand-kept second copy is the rot DAR-99 measured.
//
// WHY A DETECTOR AND NOT A PATTERN. The rule this replaces was `/\b338\b/`, commented "the
// theorem-catalog total (338)". It failed in both directions at once: it wrote the secret into a
// PUBLIC repo in order to guard it, and it was pinned to a vintage — the corpus has grown since,
// so the literal guarded a number that is no longer the leak while today's total would sail
// straight through. Both faults have the same cause: the guard was written in terms of the value
// it hides. This one is written in terms of the value we PUBLISH — every publishable theorem
// count is at most the checked total, and the catalog size is by construction above it. So the
// boundary names no secret, and re-measuring the corpus moves it automatically.

/** Wording that marks a number as a claim about the proof corpus rather than a benchmark
 * figure, a version, or a page count. Deliberately broad: it only ever NARROWS a hit that
 * already cleared the published-count band, so a false member costs nothing.
 *
 * Spanish stems are here because the spec scans `es.json` too, and an English-only test would
 * make that scan look like coverage while providing none — "El catalogo contiene 346 teoremas"
 * clears the band and matches no English stem. Free today (DAR-53 keeps a non-base catalog to
 * translated keys only, and `es` currently holds one), which is exactly why it is cheaper to add
 * now than to remember when the translation lands. `corpus`/`axioma` already overlap. */
const THEOREM_CONTEXT =
	/theorem|catalog|corpus|axiom|proven|mechaniz|teorema|cat[áa]logo|demostrad|mecaniz/i;

/** Characters either side of a number that count as "next to" the wording above. */
const CONTEXT_WINDOW = 60;

/** A bare integer: not glued to a word character, hyphen or dot on either side. That exclusion
 * is doing real work, all of it measured against the live catalogs — it drops the `256` of
 * `SHA-256`, the `767` of `0.767 µs`, the `50` of `p50`, the `2025` of `Isabelle2025-2` and
 * every segment of a version string like `4.21.06.2`, none of which is a count of anything. */
const BARE_INTEGER = /(?<![-.\w])\d+(?![-.\w])/g;

/** A percentage carrying digits. `evidence_bench_rerun_arm_body` says "within a few percent" of
 * a latency figure, which is legitimate and has no digits — the leak is the numeric form. */
const NUMERIC_PERCENTAGE = /\d\s*(?:%|percent\b)/gi;

/** Phrasings that describe the un-mechanized remainder. Necessarily partial (see findLeaks). */
const BACKLOG_WORDING: { name: string; pattern: RegExp }[] = [
	{ name: 'backlog wording', pattern: /\bbacklog\b/i },
	{ name: '"unmechanized" wording', pattern: /\bun-?mechaniz/i },
	{ name: '"remain unproven" wording', pattern: /\bremain(?:s|ing)?\b[^.]{0,40}\bunproven\b/i }
];

const withoutThousandsSeparators = (text: string) => text.replace(/(?<=\d),(?=\d{3})/g, '');

/** 1900–2099 written as four digits. The dated lines carry "December 2025" and "July 2026" next
 * to the words "corpus" and "theorems", so without this every claim card reports itself. The
 * cost is a stated blind spot: a catalog total that happens to land in that range reads as a
 * year and is missed. The corpus is in the hundreds, so it would have to grow several times
 * over before that matters — and the band's lower bound would have moved with it. */
const isCalendarYear = (literal: string, value: number) =>
	literal.length === 4 && value >= 1900 && value <= 2099;

/** The text either side of a hit. `Math.max` is load-bearing, not defensive: String.slice reads
 * a negative start as an offset from the END, so a hit in the first 60 characters would other-
 * wise be tested against the tail of the string — a wrong answer in both directions. */
const around = (text: string, at: number, length: number) =>
	text.slice(Math.max(0, at - CONTEXT_WINDOW), at + length + CONTEXT_WINDOW);

const excerpt = (text: string, at: number, length: number) =>
	`…${around(text, at, length).trim()}…`;

/**
 * Every way the catalog total can reach a published surface, in one place.
 *
 * @param text a message value, a constant, or rendered page text
 * @param publishedMax the largest theorem count we DO publish (`THEOREMS_CHECKED`)
 * @returns one description per hit; empty means clean
 */
export function findCatalogTotalLeaks(text: string, publishedMax: number): string[] {
	const hits: string[] = [];
	const scanned = withoutThousandsSeparators(text);

	// 1. A theorem count larger than the one we publish. BOTH conditions are load-bearing, and
	// each was measured against the live catalogs rather than reasoned about: drop the band and
	// "Lean 4" reports itself in 7 keys (a bare 4 beside the word "theorems"); drop the proximity
	// test and the benchmark iteration counts report themselves, 8 hits across 5 keys, led by
	// evidence_cfc_method's "1,000 warmup iterations". Neither alone is usable; together they are
	// silent on today's copy and catch a catalog total written into any of it.
	for (const match of scanned.matchAll(BARE_INTEGER)) {
		const value = Number(match[0]);
		if (value <= publishedMax || isCalendarYear(match[0], value)) continue;
		const at = match.index;
		if (THEOREM_CONTEXT.test(around(scanned, at, match[0].length)))
			hits.push(
				`theorem count ${value} above the published total: ${excerpt(scanned, at, match[0].length)}`
			);
	}

	// 2. The arithmetic route. A proven count beside "75.4% of the catalogued corpus" — the
	// phrasing the hub's own status brief uses — recovers the total to within a row, so mirroring
	// that sentence publishes the backlog while every value check stays green.
	for (const match of scanned.matchAll(NUMERIC_PERCENTAGE)) {
		const at = match.index;
		if (THEOREM_CONTEXT.test(around(scanned, at, match[0].length)))
			hits.push(
				`corpus percentage (total = count ÷ percentage): ${excerpt(scanned, at, match[0].length)}`
			);
	}

	// 3. The complement. The remainder is the total minus a published figure, so it sits BELOW
	// the band and no value rule can reach it — computing one would mean importing the secret,
	// which is the fault this module exists to undo. Wording is the only lever, so this half is
	// honestly partial: it catches the plain spellings, not a paraphrase. Kept narrow on purpose
	// — "not yet mechanized" was a candidate and is REJECTED, because evidence_proofs_axioms_
	// local_body legitimately says the prover libraries "do not yet formalize" a result, which is
	// a fact about Mathlib rather than about our backlog.
	for (const { name, pattern } of BACKLOG_WORDING) {
		const match = pattern.exec(scanned);
		if (match) hits.push(`${name}: ${excerpt(scanned, match.index, match[0].length)}`);
	}

	return hits;
}

/**
 * The same rules over a RENDERED page, where the proximity test needs help: page text is a
 * concatenation of unrelated elements rather than prose, so neither extreme works. Scanning the
 * whole blob reads the homepage's `13,000×` readout as neighbouring the theorems readout beside
 * it and reports a leak no sentence contains; scanning one line at a time misses the shape the
 * claim cards actually use — a bare value in large type with its label in the NEXT element,
 * which is precisely how a catalog total would be published (measured: `346` over "Theorems in
 * the catalog" passed the whole evidence suite).
 *
 * So the unit is a line and its successor. Both bounds are measured against the real pages: a
 * pair reunites every value with its label, and stopping there keeps the margin that matters —
 * on the homepage `13,000×` is three lines from the theorems readout, so a four-line window
 * would put them in one chunk and report the collision this split exists to avoid.
 */
export function findCatalogTotalLeaksInRenderedText(text: string, publishedMax: number): string[] {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	// A Set collapses exact repeats. It does NOT guarantee one entry per leak: a hit inside a line
	// is reached twice — as the head of its own pair and the tail of the previous one — and the
	// two excerpts differ by the neighbouring text, so both survive. That is noise in a failure
	// message rather than a miss, and the alternative discards the context that makes it useful.
	const hits = new Set<string>();
	for (const [index, line] of lines.entries())
		for (const hit of findCatalogTotalLeaks(`${line} ${lines[index + 1] ?? ''}`, publishedMax))
			hits.add(hit);
	return [...hits];
}
