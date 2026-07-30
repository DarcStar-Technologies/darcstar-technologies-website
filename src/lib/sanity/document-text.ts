// Every word of a Sanity document a reader could end up seeing, as one string (DAR-171).
//
// WHY THIS EXISTS. The evidence IP boundary (evidence-boundary.ts) and the safety-language truth
// boundary (safety-language.ts) are guarded on two surfaces: the Paraglide catalogs, by unit spec,
// and the rendered pages, by e2e. CMS prose is a THIRD publishing surface and neither reaches it —
// the catalogs don't contain it, and the e2e runs without `SANITY_VIEWER_TOKEN` (DAR-96), so every
// CMS-driven page is empty in CI. `pnpm check:cms` closes that with a hand-run scan, and this is
// the part of it that turns a document into something the detectors can read.
//
// IT IS THE HALF THAT FAILS SILENTLY, which is why it lives in `$lib` with a spec rather than
// inside the script. A detector that is handed nothing reports clean, and DAR-152 measured exactly
// that shape: "a scan whose assertions are all 'nothing matched' passes just as happily against a
// detector that answers nothing". Miss `children` and every paragraph body goes unscanned while the
// run prints a reassuring zero. So the walk is tested on the shapes it has to survive, and the
// script it serves cannot be tested in CI at all.
//
// FAIL-CLOSED WALK. Anything not explicitly skipped is descended into, including object and array
// types this file has never heard of. That polarity is the point: the Studio's schema grows (DAR-106
// added two math types; DAR-122's person fields sat unrendered for weeks), and a new block type must
// arrive INSIDE the scan by default. An allowlist of known prose fields would have the opposite
// behaviour — a field added in the Studio would be invisible here, and invisible in precisely the
// way that reports success.

/** Keys whose values are never author-supplied prose.
 *
 * Only the `_`-prefixed ones, and that is the whole rule — Sanity reserves that prefix for system
 * fields (`_type`, `_key`, `_ref`, `_id`, `_rev`, `_createdAt`), so no editor can put a sentence
 * behind one. Everything else is walked, including the fields it would be tempting to exclude:
 * `slug` renders in a URL, and a URL is published; `asset` refs carry dimensions. Neither has ever
 * produced a hit (measured across the live dataset), so skipping them would buy nothing and cost
 * the fail-closed property. */
const isSystemKey = (key: string) => key.startsWith('_');

/** Portable Text's presentation metadata: a block's `style` ("normal", "h2"), its `listItem` and
 * `level`, and a span's `marks`. All schema-fixed enums or generated keys — an editor cannot type a
 * sentence into any of them, and letting them through salts the human-readable excerpts the script
 * prints with "normal" and stray mark ids.
 *
 * A DENY-LIST, which is what keeps the fail-closed property from the header: naming what to skip
 * means a field added to the schema tomorrow is still walked. An allow-list of prose fields would
 * invert that and go quiet on exactly the additions worth catching.
 *
 * `markDefs` is deliberately NOT here. It holds link definitions, so it holds `href`s — published
 * text, and a plausible carrier (a link into the hub whose path ends in the catalog size). */
const PRESENTATION_KEYS = new Set(['style', 'listItem', 'level', 'marks']);

/** A Portable Text block: the one shape whose `children` must NOT be split across lines. */
const blockChildren = (node: Record<string, unknown>): unknown[] | null =>
	node._type === 'block' && Array.isArray(node.children) ? node.children : null;

/**
 * Flatten any Sanity value to newline-separated prose.
 *
 * ONE LINE PER TEXT RUN, and the exception is load-bearing. Array members and object fields are
 * joined with `\n`, so the result can be fed to `findCatalogTotalLeaksInRenderedText`, whose unit is
 * a line and its successor — a window measured against the real pages, reused here rather than
 * re-derived. But a BLOCK's `children` are the spans of ONE paragraph, split wherever the editor
 * applied bold or a link, so those are joined with '' — the concatenation Portable Text itself
 * defines. Splitting them would put a sentence across three lines, and a claim whose number sat in
 * the first span and whose subject sat in the third would fall outside the pair window: a miss
 * created purely by the editor's formatting.
 */
export function documentText(value: unknown): string {
	if (typeof value === 'string') return value;
	// Numbers are stringified: a numeric field is as publishable as a numeric word, and the
	// detectors' whole first route is about integers.
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value)) return value.map(documentText).filter(Boolean).join('\n');
	if (value && typeof value === 'object') {
		const node = value as Record<string, unknown>;
		const children = blockChildren(node);
		// The spans of one paragraph, rejoined into one line before anything else is considered.
		const paragraph = children ? children.map(documentText).join('') : '';
		const rest = Object.entries(node)
			.filter(
				([key]) =>
					!isSystemKey(key) && !PRESENTATION_KEYS.has(key) && !(children && key === 'children')
			)
			.map(([, field]) => documentText(field));
		return [paragraph, ...rest].filter(Boolean).join('\n');
	}
	// Booleans and null contribute nothing a reader reads.
	return '';
}

/**
 * A document split into its top-level prose fields — `[field, text]` for each one that has any.
 *
 * SCANNING PER FIELD IS ABOUT THE DETECTION WINDOW, not about prettier output.
 * `findCatalogTotalLeaksInRenderedText` reunites a value with a label on the NEXT line, which is what
 * makes it right for prose and for a claim card. Flattening a whole document instead puts unrelated
 * top-level fields on adjacent lines in whatever order the API serialized them, so any cross-field
 * pair is a coincidence of that order — which cuts both ways: a spurious pair, and an order-dependent
 * MISS when some other field lands between a number and the word that gives it meaning. Per field,
 * every pair the window forms is one an author actually wrote, and a hit can say where it is.
 *
 * The cost, accepted: a leak split across two fields — the number in `title`, the subject in
 * `excerpt` — is not seen. A leak lives in a sentence, and inside a multi-block field like `body` the
 * window still works exactly as designed.
 *
 * Empty fields are dropped rather than returned with `''`, so a caller can treat "no entries" as "no
 * prose in this document" without re-checking.
 *
 * IT FILTERS SYSTEM KEYS ONLY, deliberately — `PRESENTATION_KEYS` is not applied here, and the
 * asymmetry with `documentText` is the point rather than an oversight. Those names describe a Portable
 * Text NODE's metadata; at document top level a field called `style` or `level` is an ordinary content
 * field somebody authored, so skipping it here would be a miss. Scanning it is the fail-closed
 * direction, which is why a test pins it — the "inconsistency" is a tidy-up waiting to happen, and
 * taking it would narrow the scan.
 *
 * `documentText` stays exported alongside this because the walk is the half that fails silently, and
 * DAR-181 is the lesson: `settleSends` was tested only THROUGH its callers and its documented
 * invariant turned out to be false. The primitive gets direct tests; the composition tests also run
 * through THIS function, since it is the one the script calls.
 */
export function documentFields(doc: unknown): [field: string, text: string][] {
	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
	return Object.entries(doc as Record<string, unknown>)
		.filter(([key]) => !isSystemKey(key))
		.map(([key, value]): [string, string] => [key, documentText(value)])
		.filter(([, text]) => text.trim() !== '');
}
