import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PaperVenueDate from './PaperVenueDate.svelte';

// DAR-153. Both /research and /research/[slug] shipped `Zenodo·February 4, 2026` — the `·` sat alone
// on its own line inside an `{#if}`, and Svelte trims whitespace at a block boundary, here on both
// sides at once. It was live on all 18 cards and on every paper page, and nothing caught it, which is
// the whole reason for this file: the same trap in /news/[slug] survived indefinitely because that
// surface is empty in the live corpus, so "someone would notice" is not a guard.
//
// The assertion is that there IS separation, not that it is specifically a non-breaking space: `\s`
// matches U+00A0, so normalising first keeps these tests on the visible result rather than on the
// mechanism. That is not a loophole — a plain space here would be trimmed the moment this block is
// re-wrapped over three lines, which turns these red rather than shipping.

const shown = (container: HTMLElement) => container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('PaperVenueDate', () => {
	it('separates the venue from the date', () => {
		const { container } = render(PaperVenueDate, { venue: 'Zenodo', publishedDate: '2026-02-04' });
		expect(shown(container)).toBe('Zenodo · February 4, 2026');
	});

	// The separator exists only when it has two things to separate — otherwise the rail would open or
	// close on a dangling `·`.
	it('renders the venue alone with no separator', () => {
		const { container } = render(PaperVenueDate, { venue: 'arXiv', publishedDate: null });
		expect(shown(container)).toBe('arXiv');
	});

	it('renders the date alone with no separator', () => {
		const { container } = render(PaperVenueDate, { venue: null, publishedDate: '2025-06-11' });
		expect(shown(container)).toBe('June 11, 2025');
	});

	// No ELEMENT, not merely no text: the call sites put this in a `flex flex-wrap items-center gap-3`
	// rail, so an empty <span> would still be a flex item claiming a gap — DAR-56's empty-wrapper trap.
	// Asserting empty `textContent` would pass against exactly that, which is why this reads the DOM.
	// (Svelte leaves a `<!---->` anchor for the false `{#if}`; a comment is not laid out.)
	it.each([
		{ venue: null, publishedDate: null, why: 'neither field is set' },
		{ venue: null, publishedDate: 'not a date', why: 'the only field it has is unrenderable' }
	])('renders no element at all when $why', ({ venue, publishedDate }) => {
		const { container } = render(PaperVenueDate, { venue, publishedDate });
		expect(container.querySelector('span')).toBeNull();
		expect(container.textContent?.trim() ?? '').toBe('');
	});

	// `formatDate` returns '' for an unparseable value, so a separator gated on the RAW field renders
	// `Zenodo ·` with nothing after it. Reachable the way DAR-70's bad `doi` was: the Studio's date
	// widget is a UI affordance an API write skips. The markup this replaced had the defect.
	it('drops the separator when the date is unparseable', () => {
		const { container } = render(PaperVenueDate, { venue: 'Zenodo', publishedDate: 'not a date' });
		expect(shown(container)).toBe('Zenodo');
	});

	// Matches the site's other separators (Footer, /news, /people/[slug]): the dot is decoration, so
	// a screen reader hears "Zenodo February 4, 2026" rather than a punctuation name.
	it('hides the separator from assistive technology', () => {
		const { container } = render(PaperVenueDate, { venue: 'Zenodo', publishedDate: '2026-02-04' });
		expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('·');
	});
});
