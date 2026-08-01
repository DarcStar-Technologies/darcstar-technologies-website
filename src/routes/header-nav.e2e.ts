import { expect, test, type Page } from '@playwright/test';

// The header nav row fits the width it is revealed at (DAR-213). This lives at the route root
// beside focus-visible.e2e.ts, security-headers.e2e.ts and seo.e2e.ts for their reason: the header
// is in the root layout, so it belongs to no page, and the property is one a diff cannot show.
//
// What it is guarding. The bar is `max-w-5xl` inside a padded header, so the row's usable width is
// `min(viewport − 64, 992)` however wide the screen gets — capped. The brand lockup wants 498px on
// one line and the six anonymous items 528px once they may not break mid-phrase, with 24px between
// them: 1050 against a ceiling of 992. The row has never fitted on those terms, which is why it was
// revealed at 640px and broke at EVERY width — below ~780px spilling outside the glass panel, above
// it snapping "Sign in" and "Request access" after their first word, out past 1600px.
//
// The bar absorbs that deficit by shrinking both flex children, and THREE distinct things break as
// it does, in this order:
//
//   1. the lockup is squeezed past its own min-content and its text escapes its box;
//   2. that escaped text reaches the row and renders on top of the links;
//   3. the bar's content finally exceeds the bar and spills outside the glass panel.
//
// All three are asserted, and the order is why. The first cut of this file checked (3) and the
// wrapping alone, which made it agree that the row "fits" at 870px — where the lockup is in fact
// 80px outside its box and lying across the nav by 56px. A single failure signal here measures the
// LAST thing to break, and reports a layout as sound for another 80px of squeeze.
//
// Why a browser is the only instrument. Every input is a rendered measurement — the metrics of a
// self-hosted variable font, the flex algorithm's shrink distribution, and which media query is
// live. None of it is visible in the class attribute, which is exactly how the tier came to assert
// a fit that was never true.
//
// The anonymous nav is the binding case and the only one reachable here: e2e has no session, and
// the signed-in row (Admin + Sign out in place of Sign in + Request access) clears at 893px against
// this one's 951, measured by swapping the labels in a browser rather than assumed from their length.

/**
 * Tailwind's `lg:` — the tier Header.svelte reveals the row at.
 *
 * Derived, not chosen. Everything clears at **951px**, so `md:` (768) is not an option and neither
 * is the ~880 the ticket proposed: at 880 nothing wraps and nothing overflows, which is why a
 * weaker check waves it through, and the lockup lies across the nav by 46.5px. 960 clears it by 9px
 * and leaves 2px per label of room to grow. `lg:` is the first standard tier with margin in both
 * directions.
 *
 * Restating Tailwind's number here is the point: this and the component have to agree, and if
 * either moves alone the table below fails on the row that names the tier.
 */
const DESKTOP_MIN = 1024;

/**
 * Extra width per item the row must still absorb at `DESKTOP_MIN` — 8px each, 48px across the six,
 * roughly one more character in every label.
 *
 * A floor with room under it, not the measurement written down again: at that width the lockup
 * starts escaping its box at +13px per item, so this passes with 5px per item to give. It is here
 * because "the row fits" and "the row fits with room to spare" are different claims, and only the
 * second is a reason to have picked this tier over the ~880 one. Without it the margin could be
 * eroded to nothing — a longer label, a seventh item, a translated catalog — with every other
 * assertion in this file still green until the day it broke.
 *
 * It is deliberately small. The honest headroom here is ~15% of the label set, not the ~30% a
 * check that watched only for overflow would have reported.
 */
const EXTRA_LABEL_PX = 8;

/** Which control the header is showing: the horizontal row, or the collapsed menu. */
type NavControl = 'row' | 'menu';

const WIDTHS: Array<{ width: number; shows: NavControl; why: string }> = [
	{ width: 390, shows: 'menu', why: 'phone' },
	{ width: 768, shows: 'menu', why: 'the tier the ticket proposed — everything clears at 951' },
	{ width: DESKTOP_MIN - 1, shows: 'menu', why: 'one pixel under the tier' },
	{ width: DESKTOP_MIN, shows: 'row', why: 'the tier itself — the narrowest the row ever renders' },
	{ width: 1280, shows: 'row', why: "Playwright's default, i.e. what every other spec here sees" },
	{ width: 1600, shows: 'row', why: 'wide desktop, where the break also reproduced' }
];

type NavGeometry = {
	rowShown: boolean;
	menuShown: boolean;
	/** How far the bar's content exceeds the bar. Positive means something is spilling out of it. */
	overflow: number;
	/** How far the lockup's text reaches past its own link box. Positive means it has escaped. */
	lockupEscape: number;
	/**
	 * Clearance between the lockup's text and the row; negative means they are on top of each other.
	 * `null` where the row is not rendering — a hidden element's rect reads as zeros, which would
	 * otherwise put a confident −530 in this field and fail anything that trusted it.
	 */
	lockupClearance: number | null;
	items: Array<{ label: string; rects: number; height: number }>;
};

/**
 * Reads the bar's geometry. `extraLabelPx` widens every item first — the flex algorithm sees added
 * padding exactly as it sees a longer word, which is what lets one reader answer both "does today's
 * label set fit" and "how much longer could it get". The widening is added to whatever padding the
 * item already has rather than to a copy of it, so it stays honest if the item's padding changes.
 *
 * A wrap is counted by CLIENT RECTS: an inline element reports one rect per line box, so a label
 * broken after its first word reports 2. That is the signal that survives a restyling — it asks
 * what the browser drew rather than what any class attribute says.
 */
const readNav = (extraLabelPx: number): NavGeometry => {
	const nav = document.querySelector('header nav')!;
	// The desktop row is the first <ul> in document order; the collapsed menu is a later sibling and
	// exists only while it is open.
	const list = nav.querySelector('ul')!;
	const toggle = nav.querySelector('button[aria-controls="mobile-nav"]');
	const bar = list.parentElement!.parentElement!;
	// The brand lockup is the only anchor in the bar carrying the mark image, which names it more
	// durably than "the first link" — a skip link would take that title away without a word.
	const lockup = nav.querySelector('a:has(img)')!;
	// Its text, a flex item of that link and the thing that escapes it.
	const lockupText = lockup.querySelector('span')!;
	const items = [...list.querySelectorAll<HTMLElement>('li > a, li > form > button')];
	const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none';

	const restore = items.map((el) => el.style.paddingInline);
	if (extraLabelPx) {
		for (const el of items) {
			const own = parseFloat(getComputedStyle(el).paddingLeft);
			el.style.paddingInline = `${own + extraLabelPx / 2}px`;
		}
	}
	const textRight = lockupText.getBoundingClientRect().right;
	const rowShown = shown(list);
	const geometry: NavGeometry = {
		rowShown,
		menuShown: shown(toggle),
		overflow: +(bar.scrollWidth - bar.clientWidth).toFixed(1),
		lockupEscape: +(textRight - lockup.getBoundingClientRect().right).toFixed(1),
		lockupClearance: rowShown ? +(list.getBoundingClientRect().left - textRight).toFixed(1) : null,
		items: items.map((el) => ({
			label: el.textContent!.trim(),
			rects: el.getClientRects().length,
			height: +el.getBoundingClientRect().height.toFixed(1)
		}))
	};
	items.forEach((el, i) => (el.style.paddingInline = restore[i]));
	return geometry;
};

async function navAt(page: Page, width: number, extraLabelPx = 0): Promise<NavGeometry> {
	await page.setViewportSize({ width, height: 800 });
	await page.goto('/');
	// The labels are measured text in a self-hosted variable face, so every number below is wrong
	// until it has loaded — and wrong in the direction that PASSES, since the fallback is narrower.
	// `load` does not cover it: a webfont is fetched by the CSS that needs it.
	await page.evaluate(async () => {
		await document.fonts.ready;
	});
	return page.evaluate(readNav, extraLabelPx);
}

/** Everything a rendered row owes, whatever width produced it. */
function expectRowIsIntact(nav: NavGeometry, where: string): void {
	expect(
		nav.items.filter((item) => item.rects !== 1).map((item) => item.label),
		`${where}: a nav label broke mid-phrase. The row is narrower than its content, so either the ` +
			'labels grew or the tier that reveals them moved down — re-measure before moving either.'
	).toEqual([]);
	// A backstop for the case rects cannot report: they count LINE BOXES, so an item whose display
	// is block-ish (the signed-out row is all inline anchors, but the signed-in row ends in a
	// <button>) answers 1 however many lines it drew. Every item wears one class, so a second height
	// in the row means one of them is taller than the rest, which only a wrap does.
	expect(
		[...new Set(nav.items.map((item) => item.height))],
		`${where}: the nav items are not all the same height, so one of them wrapped`
	).toHaveLength(1);
	// The one a wrap/overflow check cannot see, and the first thing to break. Chromium squeezes the
	// lockup past its own min-content rather than stopping at it, so its box does not protect its
	// text: the text keeps its width, leaves the link and lands on the nav. Silent — nothing
	// overflows the bar, nothing wraps, and it is 80px deep before the bar notices.
	expect(
		nav.lockupClearance,
		`${where}: called with the row hidden, so there is nothing to measure the lockup against`
	).not.toBeNull();
	expect(
		nav.lockupClearance!,
		`${where}: the brand lockup is overlapping the nav row by ${-nav.lockupClearance!}px. The bar ` +
			'is squeezing the lockup to make room for the labels; give the row more width rather than ' +
			'letting the two share it.'
	).toBeGreaterThanOrEqual(0);
}

for (const { width, shows, why } of WIDTHS) {
	test(`the header shows the ${shows} at ${width}px and it fits (${why})`, async ({ page }) => {
		const nav = await navAt(page, width);

		// Which control is up, asserted in BOTH directions and before anything else. "No label
		// wrapped" is satisfied by a row that renders no labels, so hiding the nav everywhere would
		// otherwise pass this file — and that is not a hypothetical fix, it is half of the real one.
		const should = (control: NavControl) => (shows === control ? 'showing' : 'hidden');
		expect(nav.rowShown, `${width}px: the horizontal row should be ${should('row')} here`).toBe(
			shows === 'row'
		);
		expect(nav.menuShown, `${width}px: the menu toggle should be ${should('menu')} here`).toBe(
			shows === 'menu'
		);

		// Both held at every width, not only where the row renders: this is what the clipping below
		// 780px showed up as, and the lockup is squeezed by whatever shares the bar with it — the
		// collapsed menu's toggle included.
		expect(
			nav.overflow,
			`${width}px: the bar's content is ${nav.overflow}px wider than the bar, so it is spilling ` +
				'outside the glass panel'
		).toBeLessThanOrEqual(0);
		expect(
			nav.lockupEscape,
			`${width}px: the brand lockup's text is rendering ${nav.lockupEscape}px outside its own ` +
				'link box, so the bar has squeezed it past its own minimum'
		).toBeLessThanOrEqual(0);

		if (shows === 'row') expectRowIsIntact(nav, `${width}px`);
	});
}

// The tier moved up by six Tailwind steps, so every width from 640 to `DESKTOP_MIN` that used to
// get the row now depends on the menu. That is a fair trade only if the menu actually carries the
// nav there, which nothing in this repo had ever asserted at any width. Taken one pixel under the
// tier so it tracks it: the point is the widest viewport with no row, whatever that comes to.
test('the collapsed menu carries the whole nav where the row is hidden', async ({ page }) => {
	await navAt(page, DESKTOP_MIN - 1);
	await page.getByRole('button', { name: 'Open menu' }).click();

	const menu = page.locator('#mobile-nav');
	await expect(menu).toBeVisible();
	for (const label of ['About', 'News', 'Research', 'People', 'Sign in', 'Request access']) {
		await expect(menu.getByRole('link', { name: label })).toBeVisible();
	}
});

test(`the row still fits at ${DESKTOP_MIN}px with every label ${EXTRA_LABEL_PX}px wider`, async ({
	page
}) => {
	const nav = await navAt(page, DESKTOP_MIN, EXTRA_LABEL_PX);

	expect(nav.rowShown, 'the row must be rendering for this to measure anything').toBe(true);
	expectRowIsIntact(nav, `${DESKTOP_MIN}px with +${EXTRA_LABEL_PX}px labels`);
	expect(
		nav.lockupEscape,
		`the tier has no room left: ${EXTRA_LABEL_PX}px more per label squeezes the lockup ` +
			`${nav.lockupEscape}px out of its own box, and it lands on the nav ~4px later. A longer ` +
			'label, a seventh item or a translated catalog would land here — move the tier up rather ' +
			'than deleting this test.'
	).toBeLessThanOrEqual(0);
	expect(nav.overflow, 'the bar is overflowing before the lockup gave way').toBeLessThanOrEqual(0);
});
