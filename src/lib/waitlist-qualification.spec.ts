import { describe, expect, it } from 'vitest';
import { WAITLIST_ANNUAL_BUDGETS, WAITLIST_BUDGETS } from './waitlist-qualification';
import { overwriteGetLocale, baseLocale } from '$lib/paraglide/runtime';

// Paraglide resolves the locale from the request and `getLocale()` throws rather than guessing;
// there is no request here. Same escape hatch, and the same caveat, as `seo-head.spec.ts`: this
// mutates runtime module state and is never restored, which is safe only while vitest isolates per
// file. The label accessors take no locale argument by design (they are `$state`-backed and read the
// ambient one), so this has to be set before they are imported.
overwriteGetLocale(() => baseLocale);

const { waitlistBudgetLabel } = await import('./waitlist-labels');
const { m } = await import('$lib/paraglide/messages.js');

// DAR-126 re-scoped step 3's budget question from annual contract value to the budget behind an
// initial evaluation, and re-banded the options to match. `budget_range` therefore holds answers to
// two different questions — append-only submissions (DAR-88) mean the old ones are never rewritten —
// and the properties that keep those two populations tellable apart are invisible to the compiler:
// a slug reused across the change would simply dedupe inside the label map's union key, and a copy
// edit that dropped the "annual" marker would type-check perfectly.
describe('waitlist budget bands (DAR-126)', () => {
	// A floor first, so nothing below can pass by having nothing to check: an emptied retired list
	// satisfies every "for each retired band" assertion here, and satisfies the disjointness one best
	// of all.
	it('has both a live set and a retired one', () => {
		expect(WAITLIST_BUDGETS.length).toBeGreaterThan(0);
		expect(WAITLIST_ANNUAL_BUDGETS.length).toBeGreaterThan(0);
	});

	// The load-bearing one. `waitlistBudgetLabel` is keyed on the UNION of the two sets, which is only
	// unambiguous while they are disjoint — a slug in both would collapse to a single entry with a
	// single label, and whichever scope that label named, every row answered under the other scope
	// would be silently mislabelled. Re-banding again? Mint new slugs.
	it('never reuses a retired slug as a live band', () => {
		const live = new Set<string>(WAITLIST_BUDGETS);
		const reused = WAITLIST_ANNUAL_BUDGETS.filter((slug) => live.has(slug));
		expect(reused).toEqual([]);
	});

	// The operator triaging a lead sees the VALUE, not the question it answered. An unmarked band is
	// therefore read as the field's stated scope (an evaluation), so every annual one has to say so —
	// $25k–$100k a year and $25k–$50k for a pilot are opposite buying signals.
	it('marks every retired band as annual and no live band', () => {
		for (const slug of WAITLIST_ANNUAL_BUDGETS) {
			expect(waitlistBudgetLabel[slug](), slug).toMatch(/annual/i);
		}
		for (const slug of WAITLIST_BUDGETS) {
			expect(waitlistBudgetLabel[slug](), slug).not.toMatch(/annual/i);
		}
	});

	// The bands and the question have to agree about scope — the mismatch between them IS what DAR-126
	// was filed for. Asserted against the impact question too, which stays genuinely annual: without
	// that half, "no waitlist question says annual" would pass just as well, and it would be wrong.
	it('asks for an evaluation budget while impact stays annual', () => {
		expect(m.waitlist_field_budget_help()).toMatch(/evaluation or pilot/i);
		expect(m.waitlist_field_budget_help()).not.toMatch(/annual/i);
		expect(m.waitlist_field_impact_help()).toMatch(/annual/i);
	});
});
