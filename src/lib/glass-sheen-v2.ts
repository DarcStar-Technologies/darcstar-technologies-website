// DAR-170 candidate fix, opt-in via `?glassdiag=fix2`. Lives beside the current glass-sheen.ts
// rather than replacing it so the default path stays bit-identical while this is measured on a
// device; the loser gets deleted with the ticket.
//
// WHY THE FIRST ATTEMPT FAILED, because this design is a direct answer to it: that version kept the
// plane fixed and moved a clip layer with `translate3d(0, -scrollY)` written from a scroll handler.
// But `clip-path` travels WITH an element's transform, so the clip still lagged — only the property
// carrying the lag changed. It also lit rectangles where no panel was, which showed up as page
// content faintly outlined under the navbar instead of dissolving into the scrim.
//
// What the bisect actually established is narrower than it was first read as: the `noclip` arm was
// clean because its clip had NO scroll dependence at all — not because its writes were transforms.
// So the rule here is absolute: **nothing about the clip may depend on a JS-written value.**
//
// Which is achievable, because the app's glass falls into exactly two regimes and each has a
// scroll-invariant coordinate space:
//
//   page plane      position: absolute, in the page's scroll flow. The BROWSER scrolls it, on the
//                   compositor, exactly as it scrolls the glass itself — so a page-coordinate clip
//                   and the panels it describes move together by construction and cannot drift,
//                   however far behind the main thread falls.
//   viewport plane  position: fixed. Holds sticky/fixed glass — the header (`sticky top-0`) and
//                   dialog content — whose viewport rects do not change with scroll, so a
//                   viewport-coordinate clip is equally static.
//
// Both clips are therefore rebuilt only on reflow, resize, navigation and modal toggles. There is no
// scroll listener on the hot path at all, which makes this structurally the same as the `noclip` arm
// that measured clean — but with the clip in the right place.
//
// Three constraints, each measured rather than assumed (see the note on containing blocks below):
//
//   • The beams are `position: fixed`, which keeps them viewport-anchored — one coherent screen-space
//     light source, with zero JS. `clip-path` on an ancestor does NOT create a containing block for a
//     fixed descendant; `transform`, `filter`, `contain: paint` and `will-change` all DO. So none of
//     those may ever be set on a plane or anything above it, or the beam silently starts scrolling
//     with the page.
//   • The page plane is `height: 0`. An absolutely positioned element contributes to scrollable
//     overflow, so sizing it to `scrollHeight` would grow the document, which would grow the next
//     measurement. Zero height is safe because clip-path coordinates are not limited to the border
//     box — verified: a clip at page y=1000 on a zero-height plane clips a fixed child correctly.
//   • Neither plane may have `overflow: hidden`, which would clip the fixed beam to the plane's own
//     box (nothing at all, for the zero-height one).

const GLASS = '[class*="glass-"]:not(.glass-field):not(.glass-menu)';
const DIALOG = '[data-scope="dialog"]';
const EMPTY_CLIP = "path('M0 0Z')";

interface Window_ {
	el: HTMLElement;
	radius: number;
	/** True when the element's viewport rect is scroll-invariant (a fixed or sticky subtree). */
	viewportAnchored: boolean;
}

/** Rounded-rectangle SVG subpath, radius clamped to fit. Coordinates are already in the plane's space. */
function roundedRect(l: number, t: number, w: number, h: number, radius: number): string {
	const rad = Math.max(0, Math.min(radius, w / 2, h / 2));
	const n = (v: number) => v.toFixed(1);
	const [ri, b] = [l + w, t + h];
	if (rad < 0.5) return `M${n(l)} ${n(t)}H${n(ri)}V${n(b)}H${n(l)}Z`;
	const a = `${n(rad)} ${n(rad)} 0 0 1`;
	return (
		`M${n(l + rad)} ${n(t)}` +
		`H${n(ri - rad)}A${a} ${n(ri)} ${n(t + rad)}` +
		`V${n(b - rad)}A${a} ${n(ri - rad)} ${n(b)}` +
		`H${n(l + rad)}A${a} ${n(l)} ${n(b - rad)}` +
		`V${n(t + rad)}A${a} ${n(l + rad)} ${n(t)}Z`
	);
}

/**
 * Is this element in a fixed or sticky subtree — i.e. is its viewport rect scroll-invariant?
 *
 * An ancestor walk rather than a list of known components (the header, the dialog), for the same
 * reason the glass set itself is matched structurally: a list goes stale silently. Only ever called
 * from `reobserve()`, so its getComputedStyle cost is off any hot path.
 */
function isViewportAnchored(el: HTMLElement): boolean {
	for (let node: HTMLElement | null = el; node; node = node.parentElement) {
		const position = getComputedStyle(node).position;
		if (position === 'fixed' || position === 'sticky') return true;
	}
	return false;
}

function glassElements(modalOpen: boolean): HTMLElement[] {
	// While the modal is up, clip to the modal's glass ONLY (page panels sit behind the scrim and
	// would otherwise bleed sheen over it); otherwise clip to the page glass.
	return Array.from(document.querySelectorAll<HTMLElement>(GLASS)).filter(
		(el) => Boolean(el.closest(DIALOG)) === modalOpen
	);
}

/**
 * @param pagePlane     the page-flow plane (absolute, page-coordinate clip)
 * @param viewportPlane the fixed plane (viewport-coordinate clip)
 */
export function createSheenSyncV2(pagePlane: HTMLElement, viewportPlane: HTMLElement) {
	let modalOpen = false;
	let windows: Window_[] = [];

	/**
	 * @param scope `'viewport'` rebuilds only the fixed/sticky plane — see `trackViewport` below.
	 */
	function clip(scope: 'both' | 'viewport' = 'both') {
		const scrollX = window.scrollX;
		const scrollY = window.scrollY;
		let pageD = '';
		let viewD = '';
		for (const { el, radius, viewportAnchored } of windows) {
			if (scope === 'viewport' && !viewportAnchored) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			// The scroll offsets convert a viewport rect to a PAGE rect. They are read here, at rebuild
			// time — never per frame — and the result is scroll-invariant: the page plane scrolls with
			// the document, so the same path stays correct at every offset.
			if (viewportAnchored) viewD += roundedRect(r.left, r.top, r.width, r.height, radius);
			else pageD += roundedRect(r.left + scrollX, r.top + scrollY, r.width, r.height, radius);
		}
		if (scope === 'both') pagePlane.style.clipPath = pageD ? `path('${pageD}')` : EMPTY_CLIP;
		viewportPlane.style.clipPath = viewD ? `path('${viewD}')` : EMPTY_CLIP;
	}

	let retry: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	const sizeObserver = new ResizeObserver(() => clip());
	function reobserve() {
		// Rebuild the set + re-attach the observer. Never called from `clip()`: ResizeObserver
		// delivers an initial callback on observe(), so re-observing inside it would loop.
		sizeObserver.disconnect();
		sizeObserver.observe(document.documentElement);
		windows = glassElements(modalOpen).map((el) => {
			sizeObserver.observe(el);
			return {
				el,
				radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
				viewportAnchored: isViewportAnchored(el)
			};
		});
	}
	const sync = () => {
		reobserve();
		clip();
	};

	// See glass-sheen.ts for the full rationale — unchanged here: the portalled dialog Content mounts
	// late (#109), and the filter keeps unrelated background churn from re-running the whole rebuild
	// for the modal's lifetime (#117).
	const touchesDialog = (nodes: NodeList) => {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!(node instanceof Element)) continue;
			if (node.closest(DIALOG)) return true;
			if (windows.length === 0 && node.querySelector(DIALOG)) return true;
		}
		return false;
	};
	const domObserver = new MutationObserver((records) => {
		for (const rec of records)
			if (touchesDialog(rec.addedNodes) || touchesDialog(rec.removedNodes)) {
				sync();
				return;
			}
	});

	// The ONLY scroll listener, and it is debounced to fire after scrolling stops — never per frame.
	// Insurance rather than mechanism: both clips are scroll-invariant *if* the anchoring
	// classification is right, and this re-clips once at rest so a wrong call self-corrects instead of
	// leaving a permanently misplaced window. Being debounced it cannot reintroduce the defect.
	const settle = () => {
		clearTimeout(settleTimer);
		settleTimer = setTimeout(clip, 150);
	};

	// The sticky nav is viewport-anchored against the LAYOUT viewport, and on mobile that is not the
	// whole story: scrolling hard to the top expands the URL bar, which moves the visual viewport
	// under the layout one. The nav rides that movement while a static clip does not, so the nav's
	// sheen visibly slid down, ghosted, and snapped back when the debounced settle caught up.
	//
	// `visualViewport` is the event that reports exactly this, and the response is deliberately narrow:
	// rebuild ONLY the viewport plane — one or two small rects — never the page plane, whose clip is
	// genuinely scroll-invariant and must not be rewritten during a transition. rAF-batched so a burst
	// of events costs one write per frame.
	//
	// Yes, this is a clip write during a gesture, which is the shape of the original bug. The
	// difference is scale and duration: one nav rect for the ~200ms of a URL-bar animation, versus
	// every panel for as long as a scroll lasts. Nothing else can keep the nav's light on the nav.
	let vvRaf = 0;
	const trackViewport = () => {
		cancelAnimationFrame(vvRaf);
		vvRaf = requestAnimationFrame(() => clip('viewport'));
	};

	sync();
	window.addEventListener('scroll', settle, { passive: true });
	window.addEventListener('resize', sync, { passive: true });
	window.visualViewport?.addEventListener('resize', trackViewport, { passive: true });
	window.visualViewport?.addEventListener('scroll', trackViewport, { passive: true });

	return {
		refresh(nextModalOpen: boolean) {
			modalOpen = nextModalOpen;
			if (nextModalOpen)
				domObserver.observe(document.documentElement, { childList: true, subtree: true });
			else domObserver.disconnect();
			sync();
			clearTimeout(retry);
			retry = setTimeout(sync, 120);
		},
		destroy() {
			clearTimeout(retry);
			clearTimeout(settleTimer);
			cancelAnimationFrame(vvRaf);
			sizeObserver.disconnect();
			domObserver.disconnect();
			window.removeEventListener('scroll', settle);
			window.removeEventListener('resize', sync);
			window.visualViewport?.removeEventListener('resize', trackViewport);
			window.visualViewport?.removeEventListener('scroll', trackViewport);
		}
	};
}
