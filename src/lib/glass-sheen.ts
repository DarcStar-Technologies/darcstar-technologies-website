// Glass-sheen coherence (prototype). The sheen itself is a compositor-only `::after`
// on every frosted surface (see the `glass-sheen` animation in layout.css). By default
// each element runs it on the same clock, so they all glint in unison — reads as "every
// panel shimmers together", not "one light sweeps the scene".
//
// This aligns them to a single PAGE-ANCHORED light source by giving each element a
// negative `animation-delay` proportional to its position along the sweep axis
// (bottom-left → top-right), so the glint ripples across in sequence. It only sets a CSS
// variable — the animation stays transform-only, so the per-frame cost is unchanged
// (measured: Paint Δ ~0). Positions are page-relative, so scrolling needs no updates;
// we only recompute on resize (layout reflow) and when the caller re-invokes (e.g. the
// contact modal opening, which adds its own glass elements).

const SELECTOR = '.glass-panel, .glass-nav, .glass-btn';
const PERIOD_S = 7.5; // must match the CSS animation duration

function apply() {
	const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
	if (els.length === 0) return;

	// Sweep axis: bottom-left → top-right, so project each element's page-space centre
	// onto (x − y). Lower value = more bottom-left (glints first); higher = top-right.
	const d = els.map((el) => {
		const r = el.getBoundingClientRect();
		const cx = r.left + window.scrollX + r.width / 2;
		const cy = r.top + window.scrollY + r.height / 2;
		return cx - cy;
	});
	const min = Math.min(...d);
	const span = Math.max(...d) - min || 1;

	els.forEach((el, i) => {
		const frac = (d[i] - min) / span; // 0 (bottom-left) … 1 (top-right)
		el.style.setProperty('--sheen-delay', `${(-frac * PERIOD_S).toFixed(3)}s`);
	});
}

/** Start syncing; returns a cleanup that removes the resize listener. */
export function syncGlassSheen(): () => void {
	let raf = 0;
	const schedule = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(apply);
	};
	schedule();
	window.addEventListener('resize', schedule, { passive: true });
	return () => {
		cancelAnimationFrame(raf);
		window.removeEventListener('resize', schedule);
	};
}
