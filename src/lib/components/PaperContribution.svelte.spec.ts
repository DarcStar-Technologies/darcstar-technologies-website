import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PaperContribution, { contributionLabel } from './PaperContribution.svelte';
import { CONTRIBUTION_KINDS, type ContributionKind } from '$lib/research-filters';

// The kind pill (DAR-162). It answers a different question from the status pill beside it — "what is
// this" rather than "where is it in the world" — and the reason it exists is that the shelf carried
// only the second, so a theorem-only disclosure presented exactly like the rigorous formal-methods
// material. What is load-bearing here is therefore the ABSENCE cases as much as the labels: the field
// is optional with no default, so 17 of 18 papers must render nothing, and a pill that appeared
// regardless would assert that every entry's kind is known.

describe('PaperContribution', () => {
	it.each([
		['conceptual', 'Conceptual framework'],
		['formal', 'Formal result'],
		['empirical', 'Empirical study'],
		['engineering', 'Engineering report']
	] as const)('labels a %s contribution', async (contribution, label) => {
		render(PaperContribution, { contribution });
		await expect.element(page.getByText(label)).toBeVisible();
	});

	it('renders nothing for a paper that declares no kind', () => {
		const { container } = render(PaperContribution, { contribution: null });
		expect(container.textContent?.trim() ?? '').toBe('');
	});

	// `contribution` is typed as a known kind and still arrives from the CMS through a generated
	// union, so the type is a claim about the Studio's schema rather than about this value — the
	// `authorOptionLabel` lesson. The realistic route here is the Studio's enum growing without
	// CONTRIBUTION_KINDS following: a blank pill is a missing label, where an unguarded lookup would
	// throw and take the whole card down with it.
	it('renders nothing for a value outside the known kinds', () => {
		const { container } = render(PaperContribution, {
			contribution: 'speculative' as ContributionKind
		});
		expect(container.textContent?.trim() ?? '').toBe('');
	});

	// The exported labeller is what stops /research's Contribution select carrying a second copy of
	// this mapping. Asserting it covers the WHOLE vocabulary, not a sample: a kind reachable by the
	// filter but unlabelled would render an option with no text.
	it('labels every kind in the vocabulary', () => {
		for (const kind of CONTRIBUTION_KINDS) {
			expect(contributionLabel(kind)).toBeTruthy();
		}
		// Distinct, or two kinds would be indistinguishable in the select.
		const labels = CONTRIBUTION_KINDS.map(contributionLabel);
		expect(new Set(labels).size).toBe(labels.length);
	});
});
