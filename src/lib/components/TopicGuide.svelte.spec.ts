import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TopicGuide from './TopicGuide.svelte';

// DAR-56 is a VISIBILITY bug, not a rendering one — the topic descriptions were already in the
// markup, as `title` tooltips nobody without a pointer could reach. So these tests are about what
// is on screen, not what is in the DOM, and they only mean anything because this project's `client`
// vitest project runs real chromium (vite.config.ts): a jsdom run cannot tell a closed <details>
// from an open one, and every assertion below would pass against the broken version.
//
// The e2e suite deliberately does NOT cover this. CI runs Playwright without SANITY_VIEWER_TOKEN,
// so /research renders an empty index there and the guide is correctly absent — an e2e could only
// ever assert the empty state. Same reason PaperTopics is unit-tested.

const TOPICS = [
	{
		slug: 'efficient-attention',
		title: 'Efficient Attention',
		description: 'Faster attention kernels.'
	},
	{ slug: 'long-context', title: 'Long-Context', description: 'Very long sequences.' },
	{ slug: 'undescribed', title: 'Undescribed Topic', description: null }
];

describe('TopicGuide legend', () => {
	it('lists every described topic, linking each to its filtered view', async () => {
		const { container } = render(TopicGuide, { topics: TOPICS });

		const terms = [...container.querySelectorAll('dt')].map((dt) => dt.textContent?.trim());
		const details = [...container.querySelectorAll('dd')].map((dd) => dd.textContent?.trim());
		// Undescribed Topic is absent: a title with no description would just echo the facet select.
		expect(terms).toEqual(['Efficient Attention', 'Long-Context']);
		expect(details).toEqual(['Faster attention kernels.', 'Very long sequences.']);

		// The legend is navigation too — a topic name you just learned should take you to its papers.
		// Asserted on the PARAM, not the whole URL: the locale prefix is Paraglide's business and the
		// exact path shape is pinned in research-filters.spec.ts.
		//
		// Queried through the DOM rather than getByRole: a closed <details> is absent from the
		// ACCESSIBILITY tree, so a role query finds nothing here (measured — it is what failed
		// first). That is the disclosure behaving correctly, and it is also why the next test has
		// to open the thing before it can claim the body ever becomes reachable.
		const hrefs = [...container.querySelectorAll('dt a')].map((a) => a.getAttribute('href'));
		expect(hrefs[0]).toContain('topic=efficient-attention');
		expect(hrefs[1]).toContain('topic=long-context');
	});

	// The load-bearing baseline. Everything else in this file distinguishes "visible" from "in the
	// DOM", and that distinction is only real if a closed <details> actually hides its body HERE —
	// so prove it both ways rather than trusting the browser to behave: hidden while closed, visible
	// once opened. Without the second half, a locator that simply found nothing would also pass.
	it('keeps the legend body hidden until the disclosure is opened', async () => {
		const { container } = render(TopicGuide, { topics: TOPICS });
		const disclosure = container.querySelector('details');

		expect(container.querySelector('dd')?.textContent).toContain('Faster attention kernels.');
		await expect.element(page.getByText('Faster attention kernels.')).not.toBeVisible();

		expect(disclosure?.open).toBe(false);
		disclosure!.open = true;
		await expect.element(page.getByText('Faster attention kernels.')).toBeVisible();
	});

	it('renders nothing at all when no topic carries a description', () => {
		// Not an empty wrapper: /research spaces its children with `space-y-8` (`> * + *`), so a div
		// that always renders would leave a gap wherever this component has nothing to say.
		const { container } = render(TopicGuide, {
			topics: [{ slug: 'a', title: 'A', description: null }]
		});
		expect(container.textContent?.trim() ?? '').toBe('');
		expect(container.querySelector('details')).toBeNull();
	});
});

describe('TopicGuide active topic', () => {
	// THE test for DAR-56. A touch user taps a topic tag on a paper card, lands on ?topic=<slug>,
	// and must be able to read what that topic means without hovering anything (impossible) or
	// opening anything (the tooltip's problem in a new costume).
	it('shows the active topic description with nothing to open', () => {
		const { container } = render(TopicGuide, {
			topics: TOPICS,
			activeSlug: 'efficient-attention'
		});

		// The <h2> exists only in the active block, so it is an unambiguous handle on it — the
		// legend's copy of this same text is inside the closed <details> proven hidden above.
		const heading = container.querySelector('h2');
		expect(heading?.textContent?.trim()).toBe('Efficient Attention');

		const block = heading!.parentElement!;
		expect(block).toBeVisible();
		expect(block.textContent).toContain('Faster attention kernels.');
	});

	it('renders no active block for an unknown or undescribed slug', () => {
		// A hand-edited URL, or a slug renamed in the Studio.
		const unknown = render(TopicGuide, { topics: TOPICS, activeSlug: 'not-a-topic' });
		expect(unknown.container.querySelector('h2')).toBeNull();
		unknown.unmount();

		// Described-only, same as the legend: a bare title here would restate the Topic select and
		// the "Showing N of M" line for no gain.
		const undescribed = render(TopicGuide, { topics: TOPICS, activeSlug: 'undescribed' });
		expect(undescribed.container.querySelector('h2')).toBeNull();
	});
});
