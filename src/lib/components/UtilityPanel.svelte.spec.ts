import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import UtilityPanel from './UtilityPanel.svelte';
import '../../routes/layout.css';

// DAR-222. Eight pages carried this section-and-card verbatim. The component has two branches — a
// width and an optional `below` slot — and both encode a decision some page depends on, so each is
// pinned rather than left to the one-off computed-style diff that justified the extraction.

const text = (s: string) => createRawSnippet(() => ({ render: () => `<p>${s}</p>` }));

describe('UtilityPanel', () => {
	it('renders its children inside the frosted card', () => {
		const { container } = render(UtilityPanel, { children: text('Sign in') });
		const card = container.querySelector('.glass-card');
		expect(card).not.toBeNull();
		expect(card!.textContent).toContain('Sign in');
	});

	// `sm` is the default because six of the eight callers want it, and a default of `lg` would
	// silently widen every sign-in box. Asserted as the RENDERED width rather than as the prop.
	it('defaults to the narrow width', () => {
		const { container } = render(UtilityPanel, { children: text('x') });
		const card = container.querySelector('.glass-card')!;
		expect(card.classList.contains('max-w-sm')).toBe(true);
		expect(card.classList.contains('max-w-lg')).toBe(false);
	});

	it('widens for a form-bearing panel', () => {
		const { container } = render(UtilityPanel, { width: 'lg' as const, children: text('x') });
		const card = container.querySelector('.glass-card')!;
		expect(card.classList.contains('max-w-lg')).toBe(true);
		expect(card.classList.contains('max-w-sm')).toBe(false);
	});

	// The `below` content must land INSIDE the centred section and OUTSIDE the card. /waitlist's
	// restart control depends on both halves: inside the section so it stays centred under the panel,
	// outside the card so it does not read as a second CTA on DAR-64's one-CTA confirmation. A test
	// that only checked "the text appears" would pass against a slot rendered inside the card, which
	// is exactly the mistake the named slot exists to prevent.
	it('renders the below slot inside the section but outside the card', () => {
		const { container } = render(UtilityPanel, {
			children: text('panel'),
			below: text('Start over')
		});
		const section = container.querySelector('section')!;
		const card = container.querySelector('.glass-card')!;
		expect(section.textContent).toContain('Start over');
		expect(card.textContent).not.toContain('Start over');
	});

	// Absent by default — every caller but /waitlist passes nothing, and an unconditional
	// `{@render below()}` would throw for them while an empty wrapper would claim layout space.
	it('renders nothing after the card when no below slot is given', () => {
		const { container } = render(UtilityPanel, { children: text('panel') });
		const section = container.querySelector('section')!;
		expect(section.children).toHaveLength(1);
	});
});
