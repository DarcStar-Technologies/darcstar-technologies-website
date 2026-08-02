import { expect, test, type Page } from '@playwright/test';

// The header nav row fits the width it is revealed at (DAR-213), and carries what it should
// (DAR-214). This lives at the route root beside focus-visible.e2e.ts, security-headers.e2e.ts and
// seo.e2e.ts for their reason: the header is in the root layout, so it belongs to no page, and the
// property is one a diff cannot show.
//
// What it is guarding. The bar is `max-w-5xl` inside a padded header, so the row's usable width is
// `min(viewport − 64, 992)` however wide the screen gets — capped. The brand lockup wants 498px on
// one line and the five anonymous items 451px once they may not break mid-phrase, with 24px between
// them: 973 against a ceiling of 992.
//
// That margin is recent. It was 1050 against the same 992 while the row carried a sixth item, "Sign
// in", so the row did not fit at ANY width — which is why it was revealed at 640px and broke
// everywhere: below ~780px spilling outside the glass panel, above it snapping "Sign in" and
// "Request access" after their first word, out past 1600px. DAR-214 removed that item for a product
// reason rather than a layout one (a sign-in link in the primary nav claims a portal we do not have),
// and the layout is merely where it landed: the anonymous row's floor moved 951 → 873, and the
// lockup, which could not render on one line beside six items at any width whatsoever, does so from
// 1039px up. That last figure is MEASURED and the arithmetic above says 1037 — 973 of content needs
// a viewport of 1037 once the 64px of padding is back — which is the file's own rule demonstrating
// itself: sub-pixel layout is not something to derive, and two pixels is what deriving it costs.
//
// The bar absorbs that deficit by shrinking both flex children, and THREE distinct things break as
// it does, in this order:
//
//   1. the lockup is squeezed under its own contents and its text escapes its link box;
//   2. that escaped text reaches the row and renders on top of the links;
//   3. the bar's content finally exceeds the bar and spills outside the glass panel.
//
// All three are asserted, and the order is why. The first cut of this file checked (3) and the
// wrapping alone, which made it agree that the six-item row "fits" at 870px — where the lockup was
// 80px outside its box and lying across the nav by 56px. A single failure signal here measures the
// LAST thing to break, and reports a layout as sound for another 80px of squeeze.
//
// (1) and (2) are now structurally unreachable (DAR-229), so those two assertions changed job: they
// were tripwires over a live fragility and they are the proof that the fix holds. The fragility was
// that the mark contributes NOTHING to the link's automatic minimum — a flex item's `min-width`
// computes to `auto`, and this one is a replaced element — so the link's minimum came out at 252.5px
// against contents needing 332.5, and the text was what gave way. Holding the mark at its size
// (`shrink-0`, in Wordmark.svelte) puts it back into that minimum. Measured on today's five items:
// the squeeze that would produce (1) at +31px per label and (3) only at +47 produces (3) at +31 — the
// same point, the loud failure instead of the silent one, which is what `the bar fails loudly` below
// pins. Those were +13 / +26 / +13 while the row carried six; the mechanism is unchanged and only the
// per-label arithmetic moved, the link's own numbers (a 252.5px minimum against 332.5px of contents)
// being a fact about the lockup rather than about the row beside it.
//
// Why a browser is the only instrument. Every input is a rendered measurement — the metrics of a
// self-hosted variable font, the flex algorithm's shrink distribution, and which media query is
// live. None of it is visible in the class attribute, which is exactly how the tier came to assert
// a fit that was never true.
//
// The anonymous nav is the only one e2e can reach — there is no session here — and it is no longer
// the binding case. Measured by swapping the labels in a browser rather than assumed from their
// length: anonymous 873px, the signed-in staff row (a dashboard link + Sign out in place of Request
// access) 892px, and the signed-in end-user row 907px, "Account" being a wider label than "Admin".
// Removing "Sign in" took 76.3px off the width of the row nobody is signed in for — 78 off its floor
// — and nothing at all off the two this file cannot see, so the widest is now one of those. All three clear the tier by more than 100px, which
// is why that is a note rather than a problem — but if a later item narrows the gap, the end-user row
// is the one to re-measure first, and no test here will tell you so.

/**
 * Tailwind's `lg:` — the tier Header.svelte reveals the row at.
 *
 * Derived, not chosen. Everything clears at **873px** (872 overflows the bar by 1px), so `md:` (768)
 * is not an option and `lg:` is the first standard tier above it — clearing the anonymous row by
 * 151px and the widest row anyone can render, the signed-in end-user's, by 117.
 *
 * The floor was 951 while the row carried "Sign in" (DAR-214), which is where the previous version of
 * this comment argued `lg:` against the ~880 the ticket had proposed. That argument is spent — 880
 * now clears — and the tier stays where it is regardless, because the only standard tier the removal
 * brings into range is `md:`, and 768 is still 105px short.
 *
 * Restating Tailwind's number here is the point: this and the component have to agree, and if
 * either moves alone the table below fails on the row that names the tier.
 */
const DESKTOP_MIN = 1024;

/**
 * Extra width per item the row must still absorb at `DESKTOP_MIN` — 8px each, 40px across the five,
 * roughly one more character in every label.
 *
 * A floor with room under it, not the measurement written down again: at that width the bar starts
 * overflowing at +31px per item, so this passes with 23px per item to give. It is here because "the
 * row fits" and "the row fits with room to spare" are different claims. Without it the margin could
 * be eroded to nothing — a longer label, another item, a translated catalog — with every other
 * assertion in this file still green until the day it broke.
 *
 * It deliberately did NOT move when the headroom grew. That threshold was +13 while the row carried
 * six items and is +31 with five, so 8px is now ~9% of an average label rather than the ~15% it was.
 * Re-deriving it from today's item count is the one thing this constant must not do: a sixth item is
 * a product decision — DAR-214 made one, and DAR-129 may make it back — and a floor re-set at, say,
 * +16 would refuse that on layout grounds that do not exist, six items fitting with the 13px per
 * label DAR-213 measured and judged sufficient. What it guards is the tier, which has not moved.
 */
const EXTRA_LABEL_PX = 8;

/** Which control the header is showing: the horizontal row, or the collapsed menu. */
type NavControl = 'row' | 'menu';

/**
 * How much wider every label is made for the over-squeeze test — past the +31 at which the bar now
 * overflows, and inside the band where the old code failed SILENTLY (its text left the lockup at +31
 * and the bar did not notice until +47).
 *
 * That band is the whole point: it is the one squeeze that tells the two designs apart. Anywhere
 * below it both are intact, anywhere above it both are visibly broken, and only in here does the
 * question "which failure does an overrun produce" have two different answers.
 *
 * 38 also clears +35, where the unpinned lockup stops merely leaving its own box and starts lying
 * across the nav, so both silent modes are being held rather than only the first.
 *
 * It moved with the item count — it was 20, in a band of [13, 26), while the row carried six items.
 * Every number here is per LABEL, so dropping one spreads the same deficit across fewer of them and
 * every threshold in this file rises. Re-measure them; do not rescale them.
 */
const OVER_SQUEEZE_PX = 38;

/**
 * The one item the anonymous branch has beyond the content links — DAR-214 took "Sign in" from
 * beside it. Named because two tests reach for it and a re-typed copy is a label rename away from
 * asserting nothing.
 */
const SURVIVING_ITEM = 'Request access';

/**
 * What the anonymous nav carries. The four content links plus that item, and it is not "Sign in".
 */
const ANONYMOUS_ITEMS = ['About', 'News', 'Research', 'People', SURVIVING_ITEM];

const WIDTHS: Array<{ width: number; shows: NavControl; why: string }> = [
	{
		width: 320,
		shows: 'menu',
		why: "WCAG 1.4.10's reflow width, and where a 390px phone lands at 125% browser zoom"
	},
	{ width: 390, shows: 'menu', why: 'phone' },
	{
		width: 768,
		shows: 'menu',
		why: 'the tier DAR-213 rejected — 105px under the 873 the row needs'
	},
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
	// The one a wrap/overflow check cannot see. It used to be the first thing to break — the link box
	// did not protect its own text, so the text kept its width, left the link and landed on the nav,
	// silently, 80px before the bar noticed. Holding the mark closed that off (DAR-229), which makes
	// this the assertion that says so rather than a tripwire over something live.
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
	for (const label of ANONYMOUS_ITEMS) {
		await expect(menu.getByRole('link', { name: label })).toBeVisible();
	}
});

// DAR-214 took "Sign in" out of the primary nav. Not for room — it is a product claim: a sign-in link
// in the primary navigation of a deep-tech site reads as "there is a product behind this", and what
// is behind it is an account that tracks your contact messages and lets you edit your profile. So
// this asserts what the nav ADVERTISES, never that /login is unreachable: the route is untouched, the
// /admin and /account guards redirect to it, and invitation and password-reset mail lands on it.
//
// Both lists, because ONE snippet fed both of them and the realistic regression is putting the item
// back in one — a check that read only the row would call that fixed. At the narrow width the desktop
// <ul> is hidden but still in the DOM (`hidden lg:flex`), so one query over the whole nav covers the
// list nobody is looking at as well as the one they are — which does make the wide-width query
// redundant for DETECTION, said plainly rather than implied: it is kept because it fails naming the
// control a visitor is actually looking at, and because it is the half that still reports if the
// menu ever stops mounting and takes the narrow pass down with it.
//
// The positive half is load-bearing, not decoration: "there is no link to /login" is satisfied by a
// nav rendering no links at all, and by an anonymous branch that failed to render — which is the
// branch the removed item lived in. The row spells out the whole set because nothing else here does
// (the width table reads the items but only asks whether they wrapped); the menu takes one item,
// since the test above already holds it to the same list, and repeating it would only mean two
// places to edit.
//
// Matched by href rather than by label: the label is gone from the catalog entirely, and the claim
// is about where the nav sends you, so a "Partner portal" pointing at the same route would be the
// same overstatement under a new name (the ticket's own option 2 — for when /account has something
// to hold, not before). Deliberately a CONTAINS match, not a suffix one: it costs nothing here — the
// anonymous nav is the four content links, Request access and the brand lockup, none of which can
// contain that path — and it catches the spellings a suffix match would let through, a locale prefix
// or a `?next=` query.
test('the anonymous nav offers no route to /login, in either list', async ({ page }) => {
	const nav = page.locator('header nav');
	const signIn = nav.locator('a[href*="/login"]');

	await navAt(page, DESKTOP_MIN);
	const row = nav.locator('ul').first();
	await expect(row).toBeVisible();
	for (const label of ANONYMOUS_ITEMS) {
		await expect(row.getByRole('link', { name: label })).toBeVisible();
	}
	await expect(signIn, 'the desktop row is offering a sign-in link').toHaveCount(0);

	await navAt(page, DESKTOP_MIN - 1);
	await page.getByRole('button', { name: 'Open menu' }).click();
	const menu = page.locator('#mobile-nav');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('link', { name: SURVIVING_ITEM })).toBeVisible();
	await expect(signIn, 'one of the two nav lists is offering a sign-in link').toHaveCount(0);
});

test(`the row still fits at ${DESKTOP_MIN}px with every label ${EXTRA_LABEL_PX}px wider`, async ({
	page
}) => {
	const nav = await navAt(page, DESKTOP_MIN, EXTRA_LABEL_PX);

	expect(nav.rowShown, 'the row must be rendering for this to measure anything').toBe(true);
	expectRowIsIntact(nav, `${DESKTOP_MIN}px with +${EXTRA_LABEL_PX}px labels`);
	// Overflow is what running out of headroom looks like NOW, so it carries the explanation. It used
	// to be the other way round — the lockup gave way first and the escape check below held the
	// message, with this one as the "and not in the wrong order either" backstop — and DAR-229
	// inverted that without moving the messages, so the failure a real regression produced read "the
	// bar is overflowing before the lockup gave way" about a lockup that had not moved. Mutation-
	// measured, not spotted by reading.
	expect(
		nav.overflow,
		`the tier has no room left: ${EXTRA_LABEL_PX}px more per label overruns the bar by ` +
			`${nav.overflow}px. A longer label, another item or a translated catalog would land here — ` +
			'move the tier up rather than deleting this test.'
	).toBeLessThanOrEqual(0);
	// A backstop, and honestly one no reachable defect fires at this squeeze: +8 is far too small for
	// the lockup to give way even with the mark unpinned (measured — identical geometry either way).
	// It states the invariant at a second squeeze; the squeeze that actually proves it is below.
	expect(
		nav.lockupEscape,
		`the lockup gave way before the bar did — ${nav.lockupEscape}px of its text is outside its own ` +
			'box, which DAR-229 made impossible, so the mark is no longer being held (`shrink-0` in ' +
			'Wordmark.svelte)'
	).toBeLessThanOrEqual(0);
});

// What DAR-229 actually bought, and the only test here that asserts a BROKEN bar on purpose. Every
// other test says the header fits; this one says that when it stops fitting it says so.
//
// The overflow assertion is the positive control, not the finding. Everything else about this test
// is "nothing moved", which is exactly what a broken instrument reports too — if the padding
// injection silently stopped working, the lockup would be intact because nothing had been asked of
// it, and the test would pass having measured a header at rest. Requiring the bar to have actually
// given way is what makes the other assertions mean something — and it is the only place that check
// exists, since the headroom test above drives the SAME injection and asserts only that nothing
// moved, so a dead injection leaves it green.
//
// **The control runs LAST, and that ordering is load-bearing.** Inside this band an unpinned mark
// absorbs the squeeze, so the bar does NOT overflow — the lockup gives way instead, which is the
// whole point of the band. Assert the control first and undoing `shrink-0` fails on it, reporting
// "something got wider" about a header where nothing did: the right test, red for the wrong reason,
// pointing at the wrong file. Ordered this way each defect reaches the assertion written for it —
// an unpinned mark hits the escape check, a dead injection hits the control — and both were
// mutation-measured rather than reasoned about.
test(`the bar fails loudly: at ${DESKTOP_MIN}px with every label ${OVER_SQUEEZE_PX}px wider`, async ({
	page
}) => {
	const nav = await navAt(page, DESKTOP_MIN, OVER_SQUEEZE_PX);

	expect(nav.rowShown, 'the row must be rendering for this to measure anything').toBe(true);

	// The two silent modes, held under a squeeze deep enough to have produced both before the mark
	// was pinned. This is the whole claim: an overrun now leaves the panel, rather than leaving the
	// wordmark sitting on the nav where a screenshot at rest would never show it.
	expect(
		nav.lockupEscape,
		`the brand lockup's text is ${nav.lockupEscape}px outside its own link box again, so the link ` +
			'is being squeezed under its contents. Something is letting the mark shrink — it is held ' +
			'by `shrink-0` in Wordmark.svelte, and it is the only reason this failure is loud.'
	).toBeLessThanOrEqual(0);
	expect(
		nav.lockupClearance,
		'called with the row hidden, so there is nothing to measure the lockup against'
	).not.toBeNull();
	expect(
		nav.lockupClearance!,
		`the brand lockup is lying across the nav row by ${-nav.lockupClearance!}px under a squeeze ` +
			'the bar is already reporting. The bar overflowing is the failure this is supposed to have; ' +
			'text on text is the one it is supposed to have stopped having.'
	).toBeGreaterThanOrEqual(0);

	expect(
		nav.overflow,
		`+${OVER_SQUEEZE_PX}px per label no longer overruns the bar, so this proves nothing about how ` +
			'an overrun fails — and the lockup assertions above just passed against a header at rest. ' +
			'Either the padding injection stopped working or something got wider; re-measure the ' +
			'thresholds and move this constant back inside the band where the two designs differ.'
	).toBeGreaterThan(0);
});
