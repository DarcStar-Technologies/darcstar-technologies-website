import { localizeHref } from '$lib/paraglide/runtime';
import type { PapersPageByDateQueryResult } from '$lib/sanity/types';

// URL-param semantics for the /research index. Query params are the single source of state
// (?topic=&author=&origin=&sort=&page=) so filtered views are shareable, SSR-render without JS
// (native GET form), and survive reloads. Kept out of the component so they are unit-testable
// without a DOM.
//
// DAR-94 moved the WORK these params describe into GROQ. Filtering, sorting and the facet
// vocabulary all used to happen here, over a fetch of the entire corpus. The index is paginated
// now, so the fetched set is one page — and none of the three can be derived from one page: a Topic
// select built from 20 papers offers 20 papers' worth of topics, and sorting a page sorts within it
// rather than across the corpus. What remains is the half that was always about the URL rather than
// the data, plus the two derivations that still act legitimately on a page of rows
// (`isDarcstarAuthored`, `partitionByOrigin`).
//
// Page-window arithmetic lives in $lib/pagination.ts, shared with /news.

export type PaperRow = PapersPageByDateQueryResult['papers'][number];

// The param-name contract, defined ONCE: parse/build below, the form's control `name`s, and
// the topic-tag link URLs all consume this — rename here or drift silently between the JS and
// no-JS paths.
//
// `page` is deliberately NOT a member (it lives in $lib/pagination.ts), and that omission is what
// implements "changing a filter returns you to page 1": `buildFilterQuery` only emits keys it finds
// here, so the JS path cannot carry a stale page forward, and the no-JS path is a native GET form,
// which replaces the whole query string with its own fields. Adding `page` here would silently
// strand a visitor on page 7 of a filter that now has two results.
export const FILTER_PARAM = {
	topic: 'topic',
	contribution: 'contribution',
	author: 'author',
	origin: 'origin',
	sort: 'sort'
} as const;

export type ResearchOrigin = 'darcstar' | 'external';
export type ResearchSort = 'date' | 'date-asc' | 'title';

/**
 * The `paper.contribution` vocabulary (DAR-162) — what KIND of contribution an entry makes, which is
 * a different axis from `status` (the publication stage). One declaration serves three jobs: the
 * URL vocabulary, the parse validation below, and the SELECT'S DISPLAY ORDER.
 *
 * The order is the Studio's own field order, and it is meaningful rather than incidental — it reads
 * as a maturity ladder from "we are proposing this" to "we built it and here is the report".
 * Alphabetising (conceptual, empirical, engineering, formal) would scramble that for nothing, which
 * is why `contributionOptions` sorts by this list and not by the facet query's output.
 *
 * Kept in step with `schemaTypes/documents/paper.ts` in the Studio BY HAND — but NOT on trust, and
 * the direction that matters is the surprising one. Both cases measured by editing `schema.json`,
 * re-running `pnpm sanity:types` and `pnpm check`:
 *
 * | Studio change | caught by | how |
 * | --- | --- | --- |
 * | a kind ADDED | `pnpm check`, **2 errors** | `Paper['contribution']` widens past `ContributionKind`, so neither `<PaperContribution>` mount point accepts `paper.contribution` any more |
 * | a kind REMOVED | `pnpm check`, 1 error | only in a SPEC FIXTURE that happens to name the value — no production code narrows |
 *
 * So the addition case — the one that would otherwise ship a kind the control never offers — is
 * structural, and it is the mount points that enforce it rather than this list. The removal case is
 * incidental: it holds because `[slug]/page.svelte.spec.ts` enumerates all four kinds, and would go
 * quiet if that spec were ever narrowed to one. Removing a value from a published enum is not a
 * thing to do casually anyway, since documents already carry it.
 */
export const CONTRIBUTION_KINDS = ['conceptual', 'formal', 'empirical', 'engineering'] as const;

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export interface ResearchFilters {
	topic: string | null;
	contribution: ContributionKind | null;
	author: string | null;
	origin: ResearchOrigin | null;
	sort: ResearchSort;
}

/** One `<option>` of a facet select: `value` is the slug carried in the URL. */
export interface FacetOption {
	value: string;
	label: string;
}

/**
 * A facet option for the author control, which additionally carries the person's stored folded
 * name (DAR-95's `nameSortKey`). `null` whenever the document has no key — it is a `production`
 * publication artifact, so `dev` never has one.
 */
export interface AuthorOption extends FacetOption {
	key: string | null;
}

/** A research topic in use by at least one paper, with the Studio's authored `description`. */
export interface TopicEntry {
	slug: string;
	title: string;
	description: string | null;
}

/** Narrows an arbitrary URL string to a known contribution kind. */
function contributionKind(value: string | null): ContributionKind | null {
	return CONTRIBUTION_KINDS.includes(value as ContributionKind)
		? (value as ContributionKind)
		: null;
}

// Tolerant by design: a no-JS GET submit sends empty strings for untouched selects (→ null),
// and hand-edited URLs may carry junk (unknown origin/sort/contribution values fall back safely).
//
// `contribution` is validated where `topic` is not, and the asymmetry is not an oversight: a topic
// slug is authored content this file cannot enumerate, so an unknown one has to reach GROQ and
// answer nothing (the select renders it as a synthetic option so it doesn't masquerade as "All").
// A contribution kind is a closed enum we DO enumerate, so junk is discarded here and the control
// shows "All kinds" — nothing is gained by round-tripping `?contribution=banana` to Sanity.
export function parseResearchFilters(params: URLSearchParams): ResearchFilters {
	const origin = params.get(FILTER_PARAM.origin);
	const sort = params.get(FILTER_PARAM.sort);
	return {
		topic: params.get(FILTER_PARAM.topic) || null,
		contribution: contributionKind(params.get(FILTER_PARAM.contribution)),
		author: params.get(FILTER_PARAM.author) || null,
		origin: origin === 'darcstar' || origin === 'external' ? origin : null,
		sort: sort === 'title' || sort === 'date-asc' ? sort : 'date'
	};
}

export function hasActiveFilters(f: ResearchFilters): boolean {
	return (
		f.topic !== null ||
		f.contribution !== null ||
		f.author !== null ||
		f.origin !== null ||
		f.sort !== 'date'
	);
}

// Builds the canonical query string from the filter form's values (the JS enhancement path).
// Only set values carry through — and sort's default ('' option) stays out — so enhanced URLs
// remain clean (?topic=x, never ?author=&origin=). Lives here (not the component) so it's
// unit-testable and the transient URLSearchParams stays out of Svelte-file lint scope.
export function buildFilterQuery(values: { get(name: string): FormDataEntryValue | null }): string {
	const params = new URLSearchParams();
	for (const key of Object.values(FILTER_PARAM)) {
		const v = values.get(key);
		if (typeof v === 'string' && v) params.set(key, v);
	}
	return params.toString();
}

// The one place the topic-tag → filtered-list URL shape lives; both /research card tags and
// the detail page's tags link through this, so the param name can't drift from the parser's.
export function researchTopicHref(slug: string): string {
	return localizeHref(`/research?${FILTER_PARAM.topic}=${encodeURIComponent(slug)}`);
}

// The DAR-52 fail-safe polarity, in ONE place: only an explicit flag makes a paper ours, so an
// unset/null value stays third-party. Both the origin filter and the section split read it, and
// they used to spell it out separately (`!!p.darcstarAuthored`, `p.darcstarAuthored`,
// `!p.darcstarAuthored`) — three chances for the safe direction to drift.
export function isDarcstarAuthored(paper: PaperRow): boolean {
	return paper.darcstarAuthored === true;
}

// The origin split as a single partition rather than two `.filter()` walks of the same list.
// Order-preserving, which is what makes it correct under pagination: the query sorts origin-major
// (DAR-94), so a page's two sections stay contiguous and in the order the query established.
export function partitionByOrigin(papers: PaperRow[]): {
	darcstar: PaperRow[];
	external: PaperRow[];
} {
	const darcstar: PaperRow[] = [];
	const external: PaperRow[] = [];
	for (const p of papers) (isDarcstarAuthored(p) ? darcstar : external).push(p);
	return { darcstar, external };
}

/** Projects the topic facet down to the Topic select's option shape. */
export function topicOptions(topics: TopicEntry[]): FacetOption[] {
	return topics.map((t) => ({ value: t.slug, label: t.title }));
}

/**
 * The Contribution select's options (DAR-162): the kinds at least one paper actually declares, in
 * `CONTRIBUTION_KINDS` order, labelled by the caller.
 *
 * It IGNORES the order `inUse` arrives in and reads only its membership, which is the whole reason
 * this isn't `inUse.map(...)`. The facet is `array::unique` over a projection, so its order is
 * whatever the Content Lake returned rows in — stable enough in practice to hide the bug and not a
 * contract, and it would put the maturity ladder in publication order.
 *
 * Filtering to in-use values keeps the "only offer values that match at least one paper" guarantee
 * the topic and author facets already give, and it is doing real work here rather than being
 * defensive: three of the four kinds are declared by no paper today, so offering all four would ship
 * a control where 3 of 4 picks lead to "no matches". It grows as papers are classified, with nothing
 * to remember.
 *
 * `label` is injected rather than looked up so this file stays free of Paraglide — the values are
 * enum literals, so unlike a topic's authored title their display text is translatable chrome.
 */
export function contributionOptions(
	inUse: readonly string[],
	label: (kind: ContributionKind) => string
): FacetOption[] {
	return CONTRIBUTION_KINDS.filter((kind) => inUse.includes(kind)).map((kind) => ({
		value: kind,
		label: label(kind)
	}));
}

/**
 * Characters a visitor must type before the author control asks the server for suggestions.
 *
 * Shared by the input (which debounces up to this length) and by
 * `/research/authors.json` (which refuses below it), so the floor cannot hold in one place and not
 * the other — and the endpoint's copy is the one that matters, since nothing stops a caller from
 * requesting it directly.
 */
export const AUTHOR_QUERY_MIN_LENGTH = 3;

/**
 * A raw author-search string → the term to hand GROQ's `match`, or null when it is too short to
 * answer. Both cleanups are load-bearing rather than defensive, measured against production:
 * `match ("" + "*")` and `match ("*" + "*")` each hit ALL 123 people in the dataset, so an
 * unfiltered term turns a lookup into a dump of the entire author vocabulary — which is the exact
 * payload this control exists to avoid shipping.
 *
 * The wildcards are stripped rather than rejected: someone typing `Dao*` means Dao, and answering
 * an intelligible query is friendlier than refusing it. (There is no injection risk to guard
 * against — GROQ params are bound, not interpolated; this is about the PATTERN's semantics.)
 */
export function authorSearchTerm(raw: string | null | undefined): string | null {
	const cleaned = (raw ?? '').replace(/[*?]/g, '').trim();
	return cleaned.length >= AUTHOR_QUERY_MIN_LENGTH ? cleaned : null;
}

/**
 * The `label` attribute for one author `<option>`, or `undefined` to emit none (DAR-105).
 *
 * DAR-104 made the SERVER accent-blind; the browser then hid the row it found. A native
 * `<datalist>` applies its own matching to the options it is handed, and measured in headed
 * Chromium and Firefox — both controls holding, positive and negative — that matching is a
 * case-insensitive SUBSTRING test that compares CODE POINTS. So `luk` did not match
 * `Łukasz Kaiser` and no popup appeared at all.
 *
 * The two engines disagree about WHAT they compare, and that disagreement is the entire reason this
 * function returns the shape it does:
 *
 * | | chromium | firefox |
 * | --- | --- | --- |
 * | matches | `value` OR `label` | **`label` only** when present, else `value` |
 * | displays | `value` bold, `label` grey beneath | `label` if present, else `value` |
 *
 * Firefox matching only the label rules out the obvious fix. Putting an ASCII string in `value`
 * (the slug) and the real name in `label` works in Chromium and shows NOTHING in Firefox, which
 * matches the accented label — measured, not reasoned. So the label has to be the accent-blind
 * one, and it has to contain BOTH spellings, or making `luk` work would cost `Łuk` the suggestion
 * in Firefox — trading one unreachable spelling for another.
 *
 * Hence `Łukasz Kaiser (lukasz kaiser)`: one option, both spellings matchable in both engines, and
 * the person's actual name still on screen everywhere. `value` is untouched, so what a pick
 * submits — and therefore every URL this control can produce — is byte-identical to before.
 *
 * The condition is ONE containment test, and it is not a stand-in for "the name has an accent": a
 * label is emitted exactly when the key offers a spelling the name does not already contain. That
 * phrasing is what makes the whole thing structural rather than a property of today's corpus —
 * when no label is emitted the name CONTAINS the key, so matching the value alone already covers
 * every term the server could have matched, and when one is emitted it contains both strings whole.
 * The server matches a token PREFIX of `name` or `nameSortKey`, a token prefix is a substring of its
 * own string, so no row the query returns can be one the datalist then hides. Either way.
 *
 * It also picks up cases an accent test would miss — a name whose whitespace `sortKey` collapses
 * (`Tri  Dao` → `tri dao`) is reachable by the typed spelling too — and skips ones it would wrongly
 * catch: a CJK name folds to itself, so the key adds nothing and a label would be noise.
 *
 * Fail-safe in both directions. No `key` at all (a `dev` document, or one written past promote) →
 * no label, the same polarity as the query's folded arm: a publication artifact's absence must
 * degrade rather than error. And the 120-of-123 all-ASCII case → no label, which is not merely a
 * no-op but load-bearing, since Firefox DISPLAYS the label in place of the value and every one of
 * them would start rendering as its lowercased sort key.
 *
 * NOT `String.normalize('NFD')` + strip combining marks, which is the reflex: `Ł` (U+0141) has no
 * decomposition, so the reflex fixes `Ré` and `Könighofer` and leaves the headline case exactly as
 * broken. That is DAR-95's lesson, and it is why the folded form is read from the document instead
 * of derived here — the Studio owns the folding map, and a second copy of it in this repo could
 * drift with nothing to catch it.
 */
export function authorOptionLabel(option: AuthorOption): string | undefined {
	const { label, key } = option;
	// `label` is TYPED as a string and can still arrive null. `teamAuthors` projects `"label": name`
	// with no `defined(name)` filter, and a required field in the Studio is a UI affordance an API
	// write skips (DAR-70's lesson about `rule.uri`). The seed renders on every /research load, so
	// the cost of assuming here is the whole page rather than one missing suggestion.
	if (!key || !label) return undefined;
	return label.toLowerCase().includes(key.toLowerCase()) ? undefined : `${label} (${key})`;
}
