import { describe, expect, it } from 'vitest';
import { WAITLIST_ANNUAL_BUDGETS, WAITLIST_BUDGETS } from './waitlist-qualification';
import { overwriteGetLocale, baseLocale } from '$lib/paraglide/runtime';
import { waitlistBudgetLabel } from './waitlist-labels';
import { m } from '$lib/paraglide/messages.js';
import en from '../../messages/en.json';

// Paraglide resolves the locale from the request and `getLocale()` throws rather than guessing; there
// is no request here. Same escape hatch, and the same caveat, as `seo-head.spec.ts`: this mutates
// runtime module state and is never restored, which is safe only while vitest isolates per file.
//
// Unlike that spec it needs no dynamic import (measured — plain imports pass): the label map holds
// message ACCESSORS and resolves nothing at module scope, which is the same property `waitlist-labels`
// asks callers to preserve by wrapping the call, not the map, in `$derived`.
overwriteGetLocale(() => baseLocale);

// DAR-126 re-scoped step 3's budget question from annual contract value to the budget behind an
// initial evaluation, and re-banded the options to match. `budget_range` therefore holds answers to
// two different questions — append-only submissions (DAR-88) mean the old ones are never rewritten —
// and the properties that keep those two populations tellable apart are invisible to the compiler:
// a slug reused across the change would simply dedupe inside the label map's union key, and a copy
// edit that dropped the "annual" marker would type-check perfectly.
describe('waitlist budget bands (DAR-126)', () => {
	// A floor first, so nothing below can pass by having nothing to check — an emptied list satisfies
	// every "for each band" assertion here, and satisfies the disjointness one best of all. Partly
	// belt-and-braces: `expect.requireAssertions` (vite.config.ts) already turns a zero-iteration loop
	// into a failure, measured. But it can't catch an emptied LIVE list, whose loop shares a test with
	// the retired one that would still assert — and it names the cause, where "no assertions" doesn't.
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

	// The rot direction, which disjointness alone does NOT cover: the retired list only ever grows, so
	// the next re-band must APPEND rather than edit in place. Deleting an entry makes this file blinder
	// (a stored row falls back to its raw slug in triage) and every other assertion here passes — the
	// polarity DAR-102 warns about. A restated copy of the list would be a tautology, so the pin is
	// against a different artifact: the message catalog, whose `waitlist_budget_annual_*` keys exist
	// for exactly these slugs and nothing else. One-line deletions therefore report themselves; a
	// deliberate two-file removal still doesn't, but it can't be an accident.
	it('keeps one annual message per retired band, and no others', () => {
		const keyed = WAITLIST_ANNUAL_BUDGETS.map(
			(slug) => `waitlist_budget_annual_${slug.replaceAll('-', '_')}`
		);
		const inCatalog = Object.keys(en).filter((key) => key.startsWith('waitlist_budget_annual_'));
		expect(inCatalog.toSorted()).toEqual(keyed.toSorted());
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
		expect(m.waitlist_field_budget_help()).toMatch(/evaluation/i);
		expect(m.waitlist_field_budget_help()).not.toMatch(/annual/i);
		expect(m.waitlist_field_impact_help()).toMatch(/annual/i);
	});

	// The other half of the marker rule, and the half that is easy to lose: "(annual)" only means
	// something because the UNMARKED bands are read as the field's own scope, which holds only while
	// the field SAYS that scope. Rename the admin column back to a bare "Budget range" and every other
	// assertion here still passes while the triage view goes ambiguous again — the two surfaces that
	// render a band with no question beside it are the form's label and that column, so both are
	// pinned to the word the help text uses.
	it('names the scope wherever a band is shown without the question', () => {
		expect(m.waitlist_field_budget_label()).toMatch(/evaluation/i);
		expect(m.admin_waitlist_field_budget()).toMatch(/evaluation/i);
	});
});
