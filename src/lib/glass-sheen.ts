// Glass-sheen clip maintenance for the single light PLANE (.sheen-plane in
// +layout.svelte). The plane carries one transform-animated band; this keeps its
// `clip-path` set to the union of the frosted-glass windows so the beam only shows ON
// the glass — one coherent light source across every surface.
//
// Cost: the beam sweep is compositor-only (transform). The per-frame work (scroll) is just one
// getBoundingClientRect read per glass window to rebuild the clip-path — the glass SET and each
// window's (static) corner radius are resolved once in `reobserve()` (init, resize, modal-toggle,
// navigation), NOT per frame, so the scroll hot path never re-queries the DOM or calls
// getComputedStyle. Because the plane is viewport-fixed the windows move with scroll, so apply
// runs on scroll (rAF-batched), on resize, on the ResizeObserver, and on `refresh()`.

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

/** Rounded-rectangle SVG subpath for a rect, radius clamped to fit. */
function roundedRect(r: DOMRect, radius: number): string {
	const rad = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
	const n = (v: number) => v.toFixed(1);
	const { left: l, top: t, right: ri, bottom: b } = r;
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

	// The current clip set: each glass window + its (static) corner radius. Rebuilt only when the
	// set can change — `reobserve()` on init/resize/modal-toggle/navigation — so the per-scroll-frame
	// apply() re-reads only getBoundingClientRect, never re-querying the DOM or calling getComputedStyle.
	let clipped: { el: HTMLElement; radius: number }[] = [];

	function apply() {
		if (clipped.length === 0) {
			plane.style.clipPath = "path('M0 0Z')";
			return;
		}
		const d = clipped
			.map(({ el, radius }) => roundedRect(el.getBoundingClientRect(), radius))
			.join('');
		plane.style.clipPath = `path('${d}')`;
	}

	let raf = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(apply);
	};

	// Re-clip when a clipped surface changes SIZE without a scroll/resize firing — the case
	// that produced the ghost: a login/contact error banner appears inside a glass panel and
	// grows it in place (on the /login card AND the modal's Content), or a scrollbar toggles
	// and reflows the full-width glass. Nothing here fires window scroll/resize, so without
	// this the beam stays clipped to the panels' old rects — a mis-aligned ghost across every
	// surface. Observe the current glass set (catches a single panel growing, incl. the fixed
	// modal) plus documentElement (catches page reflow that shifts glass without resizing it).
	const sizeObserver = new ResizeObserver(schedule);
	function reobserve() {
		// Rebuild the clip set + re-attach the observer. Called only when the set can change (init,
		// resize, refresh, retry) — NOT from the per-frame `apply()`: ResizeObserver delivers an
		// initial callback on observe(), so re-observing inside apply() would loop (observe →
		// callback → schedule → apply → observe …). Corner radius is read once here (a static px
		// value for our rounded-* utilities), keeping getComputedStyle off the scroll hot path.
		sizeObserver.disconnect();
		sizeObserver.observe(document.documentElement);
		clipped = glassElements(modalOpen).map((el) => {
			sizeObserver.observe(el);
			return { el, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
		});
	}
	const sync = () => {
		reobserve();
		schedule();
	};

	sync();
	window.addEventListener('scroll', schedule, { passive: true });
	// Resize can change the set (breakpoints) or a responsive corner radius, so rebuild the cache
	// (sync), not just re-clip. Scroll — the hot path — stays cache-only (schedule).
	window.addEventListener('resize', sync, { passive: true });

	return {
		/**
		 * Re-clip; call whenever the set (or position) of glass windows changes — the modal
		 * opening/closing, OR a client-side route change. The plane lives in the persistent
		 * layout, so navigation doesn't rebuild this sync; without an explicit re-clip the beam
		 * stays pinned to the previous route's panels (a ghost that only lines up again after a
		 * scroll/resize). Pass the current modal-open state.
		 */
		refresh(nextModalOpen: boolean) {
			modalOpen = nextModalOpen;
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
			sizeObserver.disconnect();
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', sync);
		}
	};
}
