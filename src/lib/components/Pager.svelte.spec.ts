import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Pager from './Pager.svelte';

// The pager's whole contract is that it works with JavaScript off, so these assert MARKUP: real
// anchors with real hrefs, and inert spans at the ends. A click-handler pager would satisfy any
// "does it navigate" test in a browser and still strand a no-JS visitor on page 1.

const url = (href: string) => new URL(href, 'https://darcstar.tech');
const anchors = (root: Element) =>
	[...root.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);

describe('Pager', () => {
	it('renders nothing at all for a single page', () => {
		// Not an empty <nav>: both indexes space their children with `space-y-*` (`> * + *`), so an
		// always-present wrapper leaves a gap under the last card on every unpaginated index.
		const { container } = render(Pager, { page: 1, pageCount: 1, url: url('/research') });
		expect(container.textContent?.trim() ?? '').toBe('');
		expect(container.querySelector('nav')).toBeNull();
	});

	it('links forward but not back on the first page', () => {
		const { container } = render(Pager, { page: 1, pageCount: 4, url: url('/news') });
		expect(anchors(container)).toEqual([['Next →', '/news?page=2']]);
	});

	it('links back but not forward on the last page', () => {
		const { container } = render(Pager, { page: 4, pageCount: 4, url: url('/news?page=4') });
		expect(anchors(container)).toEqual([['← Previous', '/news?page=3']]);
	});

	it('links both ways in the middle', () => {
		const { container } = render(Pager, { page: 2, pageCount: 4, url: url('/news?page=2') });
		expect(anchors(container)).toEqual([
			['← Previous', '/news'],
			['Next →', '/news?page=3']
		]);
	});

	// The reason the pager takes a URL rather than just a page number: a visitor two pages into a
	// filtered view must not be silently returned to the unfiltered index.
	it('carries the visitor’s filters through every link', () => {
		const { container } = render(Pager, {
			page: 2,
			pageCount: 5,
			url: url('/research?topic=long-context&sort=title&page=2')
		});
		for (const [, href] of anchors(container)) {
			expect(href).toContain('topic=long-context');
			expect(href).toContain('sort=title');
		}
	});

	it('reports the position', () => {
		const { container } = render(Pager, { page: 3, pageCount: 7, url: url('/research?page=3') });
		expect(container.textContent).toContain('Page 3 of 7');
	});

	// A disabled anchor is a link that lies about being one — at the ends there is no page to point
	// at, so the affordance must not be in the tab order or the accessibility tree at all.
	it('renders the unavailable direction as an inert span, not a link', () => {
		const { container } = render(Pager, { page: 1, pageCount: 3, url: url('/research') });
		const previous = [...container.querySelectorAll('span')].find((el) =>
			el.textContent?.includes('Previous')
		);
		expect(previous).toBeDefined();
		expect(previous?.closest('a')).toBeNull();
		expect(previous?.getAttribute('aria-hidden')).toBe('true');
	});

	it('names itself so it is distinguishable from the page’s other navigation', () => {
		const { container } = render(Pager, { page: 2, pageCount: 3, url: url('/research?page=2') });
		expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Pagination');
	});
});
