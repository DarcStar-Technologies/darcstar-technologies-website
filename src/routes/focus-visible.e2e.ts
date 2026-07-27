import { expect, test, type Page } from '@playwright/test';

// Keyboard focus is visible everywhere (DAR-57). This lives at the route root beside
// security-headers.e2e.ts and seo.e2e.ts because it is the same shape of concern: one rule in
// layout.css with NO call sites, so there is nothing a code review can look at to know it fires.
// Only a real browser can answer that — a typo in the selector list, a later `outline-none`, or a
// dropped `:focus-visible` would all be invisible in the diff and silent at runtime.
//
// Focus is driven with real Tab presses rather than element.focus(): `:focus-visible` is a
// heuristic on programmatic focus (Chromium matches it only when the last interaction was already
// a keyboard one), so a scripted focus would test something adjacent to what a keyboard user does.

/** Matches layout.css's `@layer base` rule. 2px clears WCAG 2.2 SC 2.4.13's thickness floor. */
const RING_WIDTH = '2px';
const RING_STYLE = 'solid';

type Stop = {
	tag: string;
	label: string;
	outlineWidth: string;
	outlineStyle: string;
	outlineColor: string;
	/** Everything a focus state could plausibly change, so "did it change at all" is answerable. */
	appearance: string;
	/** The same string read before anything was focused — see `snapshotUnfocused`. */
	restingAppearance: string | null;
};

/** The page-side helper below, so both readers of "appearance" are the same code. */
type AppearanceWindow = Window & { __fvAppearance?: (el: Element) => string };

/**
 * Installs a page-side "what does this element LOOK like" probe, used by both the resting snapshot
 * and the walk — one definition, so the two can't compute it differently.
 *
 * The outline collapses to `no-outline` unless it is actually painted, and `outline-offset` rides
 * INSIDE that branch rather than beside it. That is load-bearing: `outline: none` (how `glass-field`
 * opts out) does not reset `outline-offset`, so the base rule's `2px` survives on the computed
 * style — and a naive join therefore reports "focus changed this element" for a change that renders
 * nothing at all. A deliberately-broken field passed the first version of this check for exactly
 * that reason.
 */
async function installAppearanceProbe(page: Page): Promise<void> {
	await page.addInitScript(() => {
		(window as AppearanceWindow).__fvAppearance = (el: Element) => {
			const s = getComputedStyle(el);
			const outline =
				s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0
					? 'no-outline'
					: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} @${s.outlineOffset}`;
			return [
				outline,
				s.boxShadow,
				s.borderColor,
				s.backgroundColor,
				s.color,
				s.textDecorationLine
			].join(' | ');
		};
	});
}

/**
 * Records how every focusable element looks while NOTHING is focused, stamped on the element itself,
 * so the walk can ask whether focus changed its appearance.
 *
 * This is what enforces the layered design's actual rule — **opt out of the ring only by REPLACING
 * it**. `glass-field` and `/admin` legitimately suppress the outline and draw their own, so they
 * can't be held to the branded ring; without this they were asserted against nothing at all, and an
 * `outline-none` added with no replacement would have gone unnoticed.
 */
async function snapshotUnfocused(page: Page): Promise<void> {
	await page.evaluate(() => {
		const appearance = (window as AppearanceWindow).__fvAppearance;
		if (!appearance) throw new Error('appearance probe missing — installAppearanceProbe first');
		document.querySelectorAll('a,button,summary,input,select,textarea').forEach((el) => {
			el.setAttribute('data-fv-resting', appearance(el));
		});
	});
}

/**
 * The ring colour as the page itself resolves it.
 *
 * Compared against a probe rather than a literal because the rule is written
 * `var(--color-primary-400)` — an oklch() value — and how a browser serializes that in a computed
 * style is its business, not this spec's. Resolving both through the same engine in the same
 * document compares the values instead of their spelling.
 *
 * `appendChild`, not `append`: Cloudflare's worker types declare their own `Element` (HTMLRewriter),
 * which DECLARATION-MERGES with the DOM's in this project's tsconfig, so `Element.append` resolves
 * to the rewriter's `(content: string | ReadableStream | Response)` overload and fails `pnpm check`.
 * `appendChild` lives on `Node`, which the worker types don't declare.
 */
async function brandRingColor(page: Page): Promise<string> {
	return page.evaluate(() => {
		const probe = document.createElement('span');
		probe.style.color = 'var(--color-primary-400)';
		probe.style.display = 'none';
		document.body.appendChild(probe);
		const color = getComputedStyle(probe).color;
		document.body.removeChild(probe);
		return color;
	});
}

/**
 * Presses Tab up to `limit` times, describing each element that takes focus.
 *
 * Each stop waits for its CSS transitions to settle first. Tailwind v4's `transition-colors`
 * includes **`outline-color`**, and most links here carry it — so the ring does not appear at its
 * final colour, it interpolates there from `currentColor` over 150ms. Reading immediately catches
 * the ring mid-fade and reports the element's own text colour, which is a fact about the timing of
 * the read rather than about the style. Filtering on `transitionProperty` keeps this bounded:
 * transitions always finish, whereas awaiting an `Animation` would hang on a looping keyframe one.
 */
async function tabThrough(page: Page, limit: number): Promise<Stop[]> {
	const stops: Stop[] = [];
	for (let i = 0; i < limit; i += 1) {
		await page.keyboard.press('Tab');
		const stop = await page.evaluate(async () => {
			const el = document.activeElement;
			if (!el || el === document.body || el === document.documentElement) return null;

			const appearance = (window as AppearanceWindow).__fvAppearance;
			if (!appearance) throw new Error('appearance probe missing — installAppearanceProbe first');

			const transitions = el.getAnimations().filter((a) => 'transitionProperty' in a);
			await Promise.allSettled(transitions.map((a) => a.finished));

			const style = getComputedStyle(el);
			return {
				tag: el.tagName.toLowerCase(),
				// Enough to name the offender in a failure without dumping the DOM. Form controls
				// have no text content, so fall back to what identifies one — otherwise a failing
				// field reports as `<input> ""` and the reader has to go find it.
				label: (
					el.getAttribute('aria-label') ||
					el.textContent?.trim() ||
					el.getAttribute('name') ||
					el.getAttribute('id') ||
					el.getAttribute('placeholder') ||
					''
				)
					.trim()
					.slice(0, 40),
				outlineWidth: style.outlineWidth,
				outlineStyle: style.outlineStyle,
				outlineColor: style.outlineColor,
				appearance: appearance(el),
				restingAppearance: el.getAttribute('data-fv-resting')
			};
		});
		// Focus left the document (the browser chrome takes the next stop) — the walk is done.
		if (!stop) break;
		stops.push(stop);
	}
	return stops;
}

// /research and /news are deliberately absent: the e2e preview runs without SANITY_VIEWER_TOKEN, so
// their lists render empty. The pages below are static, and `/` alone covers the header nav, both
// hero CTAs, glass-btn, btn-pill, inlineLinkClass, mutedLinkClass and the whole footer.
//
// `minStops` is a floor, not a count — measured at 26 / 24 / 25, set a few under each. It is there
// to fail a walk that finds nothing (the loop below would otherwise pass vacuously), not to pin the
// nav's exact shape, which would make every added link a failing test.
for (const { path, minStops } of [
	{ path: '/', minStops: 20 },
	{ path: '/evidence', minStops: 18 },
	{ path: '/login', minStops: 18 }
]) {
	test(`every keyboard focus stop on ${path} shows the branded ring`, async ({ page }) => {
		await installAppearanceProbe(page);
		await page.goto(path);

		const brandColor = await brandRingColor(page);
		await snapshotUnfocused(page);
		const stops = await tabThrough(page, 60);

		// Without this the whole spec passes vacuously if the walk finds nothing — the failure mode
		// of a test that only asserts inside a loop.
		expect(stops.length).toBeGreaterThanOrEqual(minStops);

		for (const stop of stops) {
			const where = `<${stop.tag}> "${stop.label}" on ${path}`;

			// Links and buttons are what the site-wide rule exists for: the exact ring, or nothing.
			if (stop.tag === 'a' || stop.tag === 'button') {
				expect(
					{ width: stop.outlineWidth, style: stop.outlineStyle, color: stop.outlineColor },
					where
				).toEqual({ width: RING_WIDTH, style: RING_STYLE, color: brandColor });
				continue;
			}

			// Fields legitimately suppress the ring and draw their own (glass-field's recessed
			// border + glow), so they can't be held to the exact treatment — but they still have to
			// look different when focused. This is the enforcement of "opt out only by REPLACING
			// it": an `outline-none` added with nothing behind it fails here.
			expect(stop.restingAppearance, `${where} was never snapshotted`).not.toBeNull();
			expect(stop.appearance, `${where} looks identical focused and unfocused`).not.toBe(
				stop.restingAppearance
			);
		}
	});
}

// The other half of DAR-57: an affordance wired `hover:`-only tells a mouse user the thing is
// interactive and tells a keyboard user nothing. `hover-focus:` (layout.css) is what fixes that, and
// this pins one instance of it end to end — the homepage's inline /evidence link, which carries the
// shared inlineLinkClass every content link on the site uses.
//
// BOTH halves are asserted, and the hover one is the load-bearing surprise: `hover-focus:` REPLACED
// every `hover:` on an interactive element in this repo, so a variant that lost its hover branch
// would silently kill hover feedback site-wide while every other test stayed green. (It has two
// branches for a reason — the hover one is wrapped in `@media (hover: hover)`, matching what
// Tailwind's own `hover:` compiles to, so a "simplification" to one selector is a real risk.)
test('the hover affordance fires on hover AND on keyboard focus', async ({ page }) => {
	await page.goto('/');

	const link = page.getByRole('main').getByRole('link', { name: /read the evidence/i });
	const decorationOf = () =>
		link.evaluate((el) => getComputedStyle(el).textDecorationLine as string);

	expect(await decorationOf()).not.toContain('underline');

	await link.hover();
	expect(await decorationOf()).toContain('underline');

	// Move the pointer off before testing focus, so a stuck :hover can't stand in for :focus-visible.
	await page.mouse.move(0, 0);
	await expect.poll(decorationOf).not.toContain('underline');

	// Tab until it lands on that link — a real key press, so `:focus-visible` applies (see above).
	for (let i = 0; i < 60 && !(await link.evaluate((el) => el === document.activeElement)); i += 1) {
		await page.keyboard.press('Tab');
	}
	await expect(link).toBeFocused();

	expect(await decorationOf()).toContain('underline');
});
