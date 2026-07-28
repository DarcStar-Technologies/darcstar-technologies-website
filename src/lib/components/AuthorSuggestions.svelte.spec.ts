import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthorSuggestions from './AuthorSuggestions.svelte';
import type { AuthorOption } from '$lib/research-filters';

// What the browser DOES with these options is unspecified and cannot be asserted from here — the
// datalist popup is browser chrome, absent from any page screenshot and unreachable by synthetic
// keys (DAR-104 recorded that; DAR-105 settled the behaviour out-of-band with headed browsers and an
// X root-window capture, and wrote the per-engine rules next to `authorOptionLabel`). The boundary
// this file draws is therefore deliberate and worth stating: it pins what is HANDED to the browser.
// A `<datalist>` renders nothing, so these are attribute reads, not visibility checks.

const option = (label: string, key: string | null, value: string): AuthorOption => ({
	value,
	label,
	key
});

const TEAM = option('Michael Harris', 'michael harris', 'michael-harris');
const LUKASZ = option('Łukasz Kaiser', 'lukasz kaiser', 'lukasz-kaiser');

const optionsIn = (container: HTMLElement) =>
	[...container.querySelectorAll('option')].map((o) => ({
		value: o.getAttribute('value'),
		label: o.getAttribute('label')
	}));

describe('AuthorSuggestions', () => {
	it('exposes the datalist under the id the input points at', () => {
		const { container } = render(AuthorSuggestions, {
			id: 'research-author-options',
			options: [TEAM]
		});
		expect(container.querySelector('datalist')?.id).toBe('research-author-options');
	});

	// The value is what a pick puts in the box and therefore what the filter receives, so DAR-105
	// had to leave it alone: every URL this control can produce is byte-identical to before the fix.
	it('offers the display name as the value, accented or not', () => {
		const { container } = render(AuthorSuggestions, { id: 'l', options: [TEAM, LUKASZ] });
		expect(optionsIn(container).map((o) => o.value)).toEqual(['Michael Harris', 'Łukasz Kaiser']);
	});

	// The fix itself, at the only layer that can show it reaching the DOM.
	it('labels an accented name with both spellings', () => {
		const { container } = render(AuthorSuggestions, { id: 'l', options: [LUKASZ] });
		expect(optionsIn(container)[0].label).toBe('Łukasz Kaiser (lukasz kaiser)');
	});

	// Not `label=""`. An empty attribute is present, and firefox displays the label INSTEAD of the
	// value whenever one is present — so the difference between "no attribute" and "empty attribute"
	// is the difference between an author's name and a blank row. `undefined` is what Svelte omits;
	// this asserts the omission rather than the intent.
	it('emits no label attribute at all for an all-ASCII name', () => {
		const { container } = render(AuthorSuggestions, { id: 'l', options: [TEAM] });
		const el = container.querySelector('option')!;
		expect(el.hasAttribute('label')).toBe(false);
		expect(optionsIn(container)[0].label).toBeNull();
	});

	// The seed list and an empty match set are different states upstream (`null` restores the team
	// seed, `[]` means "no matches"), but both reach this component as an array — and rendering an
	// empty datalist is correct, not a case to guard against: it is what clears stale suggestions.
	it('renders an empty datalist rather than nothing when there are no options', () => {
		const { container } = render(AuthorSuggestions, { id: 'l', options: [] });
		expect(container.querySelector('datalist')).not.toBeNull();
		expect(optionsIn(container)).toEqual([]);
	});
});
