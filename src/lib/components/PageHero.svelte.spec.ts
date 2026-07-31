import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PageHero from './PageHero.svelte';
import '../../routes/layout.css';

// DAR-218. `/about` carried a byte-identical copy of this component's markup for one reason: the
// emphasis was trailing-only, and that page leads with it. Adding `emphasisPosition` let the copy go,
// which puts a second join in an `{#if}` — and Svelte trims literal whitespace at a block boundary,
// the DAR-153 trap that shipped `Zenodo·February 4, 2026` on 18 cards.
//
// Both joins are asserted, and the two are NOT the same character on purpose (see the component).
// The separation assertions normalise whitespace first, because `\s` matches U+00A0: the claim is
// that there IS a space, not which one — a mechanism assertion would go green against a build that
// renders the right character in the wrong place. WHICH character is a separate, explicit test
// below, because the two carry different wrapping behaviour and that is the whole reason for the
// asymmetry.

const shown = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const BASE = { eyebrow: 'About', heading: 'safety for autonomous systems.' };

describe('PageHero', () => {
	it('renders a leading emphasis before the heading, separated', () => {
		const { container } = render(PageHero, {
			...BASE,
			emphasis: 'Provable',
			emphasisPosition: 'leading' as const
		});
		expect(shown(container.querySelector('h1')!)).toBe('Provable safety for autonomous systems.');
	});

	it('renders a trailing emphasis after the heading, separated', () => {
		const { container } = render(PageHero, {
			eyebrow: 'News',
			heading: 'News &',
			emphasis: 'notes'
		});
		expect(shown(container.querySelector('h1')!)).toBe('News & notes');
	});

	// Trailing is the default, so every existing call site keeps its rendering without passing a prop.
	// Asserted rather than assumed: a default of 'leading' would silently reverse eight headings.
	it('defaults to trailing', () => {
		const { container } = render(PageHero, { eyebrow: 'People', heading: 'Our', emphasis: 'team' });
		expect(shown(container.querySelector('h1')!)).toBe('Our team');
	});

	// The join characters differ, and each is load-bearing in a different direction:
	//
	//   trailing → U+00A0, so a one-word emphasis can't be orphaned onto its own line under a
	//              heading that wrapped above it.
	//   leading  → a real breaking space. `/about`'s emphasis is followed by the entire heading, so
	//              binding them makes "Provable safety" one unbreakable 15-character run — at
	//              text-4xl that is ~270px against a ~248px card interior on a 360px screen, i.e. it
	//              overflows rather than wraps. This is the assertion that would fail if someone
	//              "tidied" the two joins into one.
	it('binds a trailing emphasis but lets a leading one wrap', () => {
		const trailing = render(PageHero, { eyebrow: 'News', heading: 'News &', emphasis: 'notes' });
		expect(trailing.container.querySelector('h1')!.textContent).toContain(' ');

		const leading = render(PageHero, {
			...BASE,
			emphasis: 'Provable',
			emphasisPosition: 'leading' as const
		});
		const h1 = leading.container.querySelector('h1')!.textContent ?? '';
		expect(h1).not.toContain(' ');
		expect(h1).toContain('Provable safety');
	});

	// Detail pages pass CMS copy with no emphasis at all. Neither join may leave a stray space, and
	// no empty gradient span may render — `charge-flow` clips its text to a moving gradient, so an
	// empty one is an invisible element the sheen and the a11y tree both still see.
	it('renders the heading alone when there is no emphasis', () => {
		const { container } = render(PageHero, { eyebrow: 'News', heading: 'A paper title' });
		expect(shown(container.querySelector('h1')!)).toBe('A paper title');
		expect(container.querySelector('.charge-flow')).toBeNull();
	});

	// The lede is optional (detail pages omit it) and must leave no empty <p> behind it — the hero's
	// panel spaces its children, so an empty paragraph claims a margin. DAR-56's empty-wrapper trap.
	it('renders no lede element when none is given', () => {
		const { container } = render(PageHero, { ...BASE, emphasis: 'Provable' });
		expect(container.querySelector('.glass-card p')).toBeNull();
	});

	// The slot is what CosmicBackdrop measures to place AND size the helix (it caps the amplitude at
	// 42% of this height), so its id is an interface between two files rather than a styling hook.
	it('exposes the helix slot CosmicBackdrop measures', () => {
		const { container } = render(PageHero, { ...BASE, emphasis: 'Provable' });
		expect(container.querySelector('#helix-slot')).not.toBeNull();
	});
});
