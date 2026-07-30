// Glass-sheen clip maintenance for the light PLANE (.sheen-plane in +layout.svelte). The plane
// carries a transform-animated band; this keeps each layer's `clip-path` set to the union of the
// frosted-glass windows so the beam only shows ON the glass — one coherent light source across every
// surface.
//
// THE CLIP IS NEVER REWRITTEN ON SCROLL (DAR-170). It used to be: one getBoundingClientRect per glass
// window per scroll frame, rebuilding the plane's clip-path. On desktop that is imperceptible; on
// mobile, scroll runs on the compositor thread and scroll events are delivered asynchronously and
// coalesced, so the clip described where the glass WAS — hard-edged windows lagging against crisp
// glass borders, worse the faster you scrolled. Bisected on a real device: removing only the
// per-frame write (plane, beam and animation all still present) cleared it, in both motion modes.
//
// So the geometry moved into coordinate spaces that don't change with scroll, and scroll now writes
// only TRANSFORMS — which the compositor re-composites rather than re-rasterizing:
//
//   .sheen-plane                     fixed, overflow:hidden, no clip of its own
//    ├─ [data-sheen-layer=viewport]  clip in VIEWPORT coords — sticky/fixed glass (nav, dialog).
//    │   └─ beam                     Their viewport rects don't move with scroll, so: no transform.
//    └─ [data-sheen-layer=page]      clip in PAGE coords — everything in normal flow.
//        └─ anchor                   translate3d(0, +scrollY) — cancels the layer's shift, so the
//            └─ beam                 beam stays screen-anchored: one light source, as before.
//                                    layer itself: translate3d(0, -scrollY)
//
// Both per-frame writes are transforms on their own composited layers. A transform that lags is
// invisible here (the beam is a soft, wide, low-alpha gradient — a few hundred px of lag doesn't
// read), which is exactly what was NOT true of a clip edge sitting on a visible border.
//
// Two layers rather than one because the app has both anchoring regimes and they are irreconcilable
// in a single coordinate space: the header is `sticky top-0` (viewport-invariant) and dialog content
// is fixed, while page panels move with scroll. Anchoring is decided STRUCTURALLY — an ancestor walk
// for `position: fixed | sticky` — not from a list of known components, for the same reason the glass
// set itself is matched structurally (#108). Each layer carries its own beam; they share keyframes
// and mount together, so their phase matches, and at a 31.4s sweep any sub-frame offset is invisible.

// Every RAISED frosted surface, matched STRUCTURALLY rather than by an enumerated class list:
// any element whose class carries a `glass-*` variant (glass-nav, glass-card, glass-btn, and any
// future one) — all built on the shared `glass` base utility (see layout.css). This is why the
// light can't silently miss a surface again: the earlier list named `.glass-panel`, but panels
// are authored as `.glass-card` (a utility only `@apply`s styles — it never puts its own name on
// the element), so `.glass-panel` matched nothing, the panels were never lit, and a growing modal
// panel never re-clipped → the button ghost. Recessed wells (`.glass-field`) and floating menus
// (`.glass-menu`) are excluded — light glints off raised glass, not wells or dropdowns.
const GLASS = '[class*="glass-"]:not(.glass-field):not(.glass-menu)';
const DIALOG = '[data-scope="dialog"]';
const EMPTY_CLIP = "path('M0 0Z')";

/** A clipped window: the element, its (static) corner radius, and which coordinate space it lives in. */
interface Window_ {
	el: HTMLElement;
	radius: number;
	/** True when the element's viewport rect is scroll-invariant (a fixed or sticky subtree). */
	viewportAnchored: boolean;
}

/** Rounded-rectangle SVG subpath, radius clamped to fit. Coordinates are already in the layer's space. */
function roundedRect(
	left: number,
	top: number,
	width: number,
	height: number,
	radius: number
): string {
	const rad = Math.max(0, Math.min(radius, width / 2, height / 2));
	const n = (v: number) => v.toFixed(1);
	const [l, t, ri, b] = [left, top, left + width, top + height];
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
 * Does this element sit in a fixed or sticky subtree — i.e. is its viewport rect scroll-invariant?
 *
 * Walks ancestors rather than testing the element alone: the dialog's glass panel is often a child of
 * the fixed positioner, and the nav's glass is a child of the `sticky` header. Only ever called from
 * `reobserve()`, never from the scroll path, so the getComputedStyle cost is off the hot path.
 */
function isViewportAnchored(el: HTMLElement): boolean {
	for (let node: HTMLElement | null = el; node; node = node.parentElement) {
		const position = getComputedStyle(node).position;
		if (position === 'fixed' || position === 'sticky') return true;
	}
	return false;
}

function glassElements(modalOpen: boolean): HTMLElement[] {
	// While the modal is up, clip to the modal's glass ONLY (page panels sit behind the
	// scrim and would otherwise bleed sheen over it); otherwise clip to the page glass.
	// `closest(DIALOG)` matches the dialog Content itself (it carries data-scope="dialog")
	// and its buttons — reliable regardless of which dialog part comes first in the DOM.
	return Array.from(document.querySelectorAll<HTMLElement>(GLASS)).filter(
		(el) => Boolean(el.closest(DIALOG)) === modalOpen
	);
}

export function createSheenSync(plane: HTMLElement) {
	let modalOpen = false;

	// The two clip surfaces and the beam anchor, resolved once. Queried rather than passed as
	// arguments so the layout's `{@attach}` keeps its one-parameter shape; `null` if the markup ever
	// stops matching, which leaves that layer inert rather than throwing on every scroll frame.
	const viewportLayer = plane.querySelector<HTMLElement>('[data-sheen-layer="viewport"]');
	const pageLayer = plane.querySelector<HTMLElement>('[data-sheen-layer="page"]');
	const pageAnchor = pageLayer?.querySelector<HTMLElement>('[data-sheen-anchor]') ?? null;

	// The current clip set: each glass window, its (static) corner radius, and its coordinate space.
	// Rebuilt only when the set or the page geometry can change — never per scroll frame.
	let windows: Window_[] = [];

	/**
	 * Rebuild both layers' clip paths. Page-anchored windows are converted to page coordinates
	 * (`rect + scroll`), which is what makes them scroll-invariant; viewport-anchored ones are used
	 * as-is. Called on init, resize, the observers, a modal toggle, navigation, and once after a
	 * scroll settles — see `settle` below.
	 */
	function clip() {
		const scrollX = window.scrollX;
		const scrollY = window.scrollY;
		let viewport = '';
		let page = '';
		for (const { el, radius, viewportAnchored } of windows) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (viewportAnchored) {
				viewport += roundedRect(r.left, r.top, r.width, r.height, radius);
			} else {
				page += roundedRect(r.left + scrollX, r.top + scrollY, r.width, r.height, radius);
			}
		}
		if (viewportLayer) viewportLayer.style.clipPath = viewport ? `path('${viewport}')` : EMPTY_CLIP;
		if (pageLayer) pageLayer.style.clipPath = page ? `path('${page}')` : EMPTY_CLIP;
	}

	/**
	 * The whole scroll hot path: two transform writes, no geometry reads, no style reads.
	 *
	 * The page layer shifts up by the scroll offset so its page-coordinate clip lands where the glass
	 * actually is; the anchor inside it shifts back down by the same amount so the beam stays fixed to
	 * the screen. `translate3d` rather than `translate` to keep each on its own compositing layer.
	 */
	function track() {
		const y = window.scrollY;
		const x = window.scrollX;
		if (pageLayer) pageLayer.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;
		if (pageAnchor) pageAnchor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
	}

	let raf = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	const schedule = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(track);
	};

	/**
	 * Re-clip once a scroll has stopped.
	 *
	 * Insurance, not the mechanism. The per-frame rebuild used to hide any staleness by re-reading
	 * every rect constantly; with it gone, a layout shift that moves page glass without resizing
	 * anything the observers watch would leave the clip stale until the next resize. A debounced pass
	 * self-heals that, and being debounced it cannot reintroduce a per-frame paint-property write.
	 */
	const settle = () => {
		clearTimeout(settleTimer);
		settleTimer = setTimeout(clip, 150);
	};

	// Re-clip when a clipped surface changes SIZE without a resize firing — the case that produced
	// the ghost this module was first written for: a login/contact error banner appears inside a glass
	// panel and grows it in place (on the /login card AND the modal's Content), or a scrollbar toggles
	// and reflows the full-width glass. Observe the current glass set (catches a single panel growing,
	// incl. the fixed modal) plus documentElement (catches page reflow that shifts glass without
	// resizing it).
	const sizeObserver = new ResizeObserver(clip);
	function reobserve() {
		// Rebuild the clip set + re-attach the observer. Called only when the set can change (init,
		// resize, refresh, retry) — NOT from `clip()`: ResizeObserver delivers an initial callback on
		// observe(), so re-observing inside it would loop (observe → callback → clip → observe …).
		// Corner radius and anchoring are resolved once here — both need getComputedStyle, which is
		// exactly what must stay off the scroll path.
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
		track();
	};

	// While a modal is open, its glass (the Dialog.Content) is PORTALLED and mounts a tick — or, on
	// a slow device/large bundle, more — after `open` flips. The 120ms `retry` below usually catches
	// it, but a later mount would leave the sizeObserver unattached to the Content, so a subsequent
	// error banner growing it wouldn't re-clip → the button ghost recurs (issue #109). This
	// MutationObserver re-syncs when the dialog's own DOM changes, so the sizeObserver attaches the
	// instant the Content exists (however late, and wherever the dialog's Portal mounts it) and the
	// error-banner insertion is caught directly too. It runs ONLY while a modal is open (see
	// `refresh`) and watches childList/subtree only, never attributes, so the clip/transform writes
	// (style attrs on the layers) can't retrigger it.
	//
	// It observes documentElement (agnostic to where the Portal mounts) but FILTERS to mutations that
	// add/remove the dialog itself or a node inside it: `sync` → `reobserve()` is a whole-document
	// querySelectorAll + per-element getComputedStyle, so letting unrelated background churn re-run it
	// on every mutation for the modal's lifetime would undo the caching win from #108 (issue #117).
	// Background mutations don't touch `[data-scope="dialog"]` glass, so `touchesDialog` skips them;
	// only the dialog's mount and its own inner insertions (the error banner) re-sync.
	//
	// The check is two-tier so background churn stays cheap: `closest` (an ancestor walk) catches the
	// dialog itself and anything nested in it — the error banner — and is all that's needed once the
	// dialog's glass is mounted. The `querySelector` subtree scan is only there to spot the Content
	// under a non-`data-scope` Portal wrapper AT MOUNT (MutationObserver reports the added subtree's
	// root, not its descendants). It's gated on `windows.length === 0` (no dialog glass clipped yet →
	// still mounting; `windows` holds dialog glass ONLY while a modal is open), so after the Content is
	// mounted + clipped, background subtrees pay only the cheap `closest`. Keying the gate on `windows`
	// rather than a first-match flag keeps the scan active if a non-glass part (the backdrop) happens
	// to mount in an earlier batch than the Content.
	const touchesDialog = (nodes: NodeList) => {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!(node instanceof Element)) continue; // text nodes have neither closest nor querySelector
			if (node.closest(DIALOG)) return true; // the dialog itself, or the error banner nested in it
			if (windows.length === 0 && node.querySelector(DIALOG)) return true; // pre-mount: Content under a wrapper
		}
		return false;
	};
	const domObserver = new MutationObserver((records) => {
		for (const rec of records)
			if (touchesDialog(rec.addedNodes) || touchesDialog(rec.removedNodes)) {
				sync();
				return; // one reobserve per batch is enough — it rebuilds the whole clip set
			}
	});

	sync();
	// Scroll writes transforms only (`schedule` → `track`); the clip is rebuilt once the scroll stops.
	window.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('scroll', settle, { passive: true });
	// Resize can change the set (breakpoints) or a responsive corner radius, so rebuild the cache
	// (sync), not just re-clip.
	window.addEventListener('resize', sync, { passive: true });

	return {
		/**
		 * Re-clip; call whenever the set (or position) of glass windows changes — the modal
		 * opening/closing, OR a client-side route change. The plane lives in the persistent
		 * layout, so navigation doesn't rebuild this sync; without an explicit re-clip the beam
		 * stays clipped to the previous route's panels. Pass the current modal-open state.
		 */
		refresh(nextModalOpen: boolean) {
			modalOpen = nextModalOpen;
			// Watch the whole document (documentElement — agnostic to where the dialog's Portal mounts,
			// rather than assuming <body>) for the dialog's possibly-late mount, but ONLY while a modal
			// is up: a persistent site-wide subtree observer would re-sync on every unrelated DOM change.
			if (nextModalOpen)
				domObserver.observe(document.documentElement, { childList: true, subtree: true });
			else domObserver.disconnect();
			sync();
			// The new glass mounts a tick after this call (the portalled dialog after `open`
			// flips; the next route's panels after navigation), so re-observe + re-clip once more
			// shortly after — the immediate pass can run before that glass is in the DOM.
			clearTimeout(retry);
			retry = setTimeout(sync, 120);
		},
		destroy() {
			cancelAnimationFrame(raf);
			clearTimeout(retry);
			clearTimeout(settleTimer);
			sizeObserver.disconnect();
			domObserver.disconnect();
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('scroll', settle);
			window.removeEventListener('resize', sync);
		}
	};
}
