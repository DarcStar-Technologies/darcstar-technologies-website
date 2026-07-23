// Waitlist "interest" is FREE TEXT, not an enum (issue-tracked decision) — the form offers a
// <datalist> of suggestions to guide input without constraining it, and the set GROWS from real
// submissions over time. This module owns the pure merge that folds the curated seed (localizable
// Paraglide accessors — see waitlist-interest-seed-labels.ts) together with DB-observed values.

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
