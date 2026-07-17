// Glass-sheen clip maintenance for the single light PLANE (.sheen-plane in
// +layout.svelte). The plane carries one transform-animated band; this keeps its
// `clip-path` set to the union of the frosted-glass windows so the beam only shows ON
// the glass — one coherent light source across every surface.
//
// Cost: the beam sweep is compositor-only (transform). The work here is reading the
// glass rects and rebuilding the clip-path; because the plane is viewport-fixed the
// windows move with scroll, so it runs on scroll (rAF-batched), resize, and whenever
// the caller calls `refresh()` (the contact modal opening/closing). Measured: this adds
// no per-frame Paint — only a small getBoundingClientRect pass per scroll frame.

// Every frosted surface. `.glass-field` (recessed inputs) is intentionally excluded —
// light glints off raised glass, not the wells.
const GLASS = '.glass-nav, .glass-panel, .glass-btn';
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
	if (modalOpen) {
		// While the modal is up, the plane sits above the scrim — so clip to the modal's
		// glass only, or page panels behind the scrim would bleed sheen over it.
		const dialog = document.querySelector(DIALOG);
		if (!dialog) return [];
		return Array.from(dialog.querySelectorAll<HTMLElement>(GLASS));
	}
	// Page glass, minus anything living inside a (closed but still-mounted) dialog.
	return Array.from(document.querySelectorAll<HTMLElement>(GLASS)).filter(
		(el) => !el.closest(DIALOG)
	);
}

export function createSheenSync(plane: HTMLElement) {
	let modalOpen = false;

	function apply() {
		const els = glassElements(modalOpen);
		if (els.length === 0) {
			plane.style.clipPath = "path('M0 0Z')";
			return;
		}
		const d = els
			.map((el) =>
				roundedRect(
					el.getBoundingClientRect(),
					parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
				)
			)
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

	return {
		/** Re-clip; call when the set of glass elements changes (modal open/close). */
		refresh(nextModalOpen: boolean) {
			modalOpen = nextModalOpen;
			// A rAF lets the portalled dialog mount before we read its rects.
			schedule();
		},
		destroy() {
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
		}
	};
}
