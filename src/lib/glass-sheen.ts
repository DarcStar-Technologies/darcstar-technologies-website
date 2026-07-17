// Glass-sheen PATH 2 (single light plane) — prototype.
//
// A single fixed overlay (`.sheen-plane` in +layout.svelte) carries one soft diagonal
// band, transform-animated across the viewport. This keeps its `clip-path` set to the
// union of the frosted-glass rectangles, so the band is only visible ON the glass — one
// coherent light source whose geometry (not just timing) is shared across every panel.
//
// Cost profile vs path 1: the beam sweep is compositor-only (transform), same as before.
// The NEW cost is here — reading the glass rects and rebuilding the clip-path. Because
// the plane is viewport-fixed, the windows move as you scroll, so this must run on
// scroll (rAF-batched) as well as resize. That's the tradeoff path 1 avoided.
//
// Scope: the homepage sections (.glass-panel). Sharp rects (rounded corners not clipped)
// — a prototype; rounding would need arc segments in the path.

const SELECTOR = '.glass-panel';

export function syncSheenPlane(plane: HTMLElement): () => void {
	function apply() {
		const rects = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).map((el) =>
			el.getBoundingClientRect()
		);
		if (rects.length === 0) {
			plane.style.clipPath = "path('M0 0Z')";
			return;
		}
		// One rectangular subpath per glass window, in the plane's (viewport) coordinates.
		const d = rects
			.map((r) => {
				const l = r.left.toFixed(1);
				const t = r.top.toFixed(1);
				const ri = r.right.toFixed(1);
				const b = r.bottom.toFixed(1);
				return `M${l} ${t}H${ri}V${b}H${l}Z`;
			})
			.join('');
		plane.style.clipPath = `path('${d}')`;
	}

	let raf = 0;
	const schedule = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(apply);
	};
	schedule();
	window.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', schedule, { passive: true });
	return () => {
		cancelAnimationFrame(raf);
		window.removeEventListener('scroll', schedule);
		window.removeEventListener('resize', schedule);
	};
}
