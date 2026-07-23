// Waitlist "interest" is FREE TEXT, not an enum (issue-tracked decision) — the form offers a
// <datalist> of suggestions to guide input without constraining it, and the set GROWS from real
// submissions over time. This module owns the curated SEED plus the pure merge that folds in
// DB-observed values.
//
// The seeds are brand-relevant example interests, treated as DATA (proper-noun-like, single source),
// rendered via `{expr}` in the datalist so the no-raw-text rule is satisfied without a Paraglide key
// per suggestion — a good fit since the DB-derived half can't be localized anyway, and `es` (still an
// untranslated placeholder) falls back to `en`. Same "identical across locales" rationale as site.ts.
export const WAITLIST_INTEREST_SEED = [
	'Robotics & control',
	'Autonomous systems',
	'Financial markets',
	'Formal methods & verification',
	'Safety-critical software',
	'Partnership'
] as const;

// Overall cap on datalist entries — a suggestion list, not an archive.
const MAX_SUGGESTIONS = 30;

/**
 * Merge the curated seed with DB-observed interests into one datalist. Pure (unit-tested): seeds
 * come first (curated, brand-relevant), then observed values not already present, deduped
 * case-insensitively (first spelling wins), blanks dropped, capped. The caller is responsible for
 * only passing observed values that clear a frequency floor (so one-off free-text — possibly junk or
 * PII — never surfaces publicly); this function just merges.
 */
export function mergeInterestSuggestions(
	seed: readonly string[],
	observed: readonly string[]
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of [...seed, ...observed]) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
		if (out.length >= MAX_SUGGESTIONS) break;
	}
	return out;
}
