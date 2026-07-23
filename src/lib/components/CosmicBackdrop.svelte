<script lang="ts">
	// Fixed, full-viewport decorative canvas: the cosmic void (dark-only site).
	// Black + nebula glows + a persistent starfield + a twisting triple helix that
	// stays fixed in the background as the page scrolls. The helix scales as a rigid
	// unit (amplitude tracks its width) and centres in the hero's #helix-slot gap.
	// Respects prefers-reduced-motion.
	import { prefersReducedMotion } from 'svelte/motion';
	import { contactDialog } from '$lib/contact-dialog.svelte';

	// Bridge: the $effect at the bottom flips the backdrop's pause flag when the contact
	// modal opens/closes, WITHOUT re-running the attachment (which would re-init the
	// canvas). The modal is the site's only full-viewport overlay; while it's up, its
	// scrim + glass panel re-blur the backdrop every frame, so freezing the canvas is a
	// pure win and invisible — you're looking at the modal, not the void behind it.
	let setModalOpen: ((open: boolean) => void) | undefined;

	function backdrop(canvas: HTMLCanvasElement) {
		// Defer init by one frame (DAR-50): this attachment runs INSIDE the root layout's
		// hydration task — already the page's longest controllable main-thread task on
		// mobile — and the first resize()+draw (viewport-sized gradient fills + starfield)
		// is the heaviest one-off canvas work. One rAF splits it into its own short task.
		// Nothing visible changes: the canvas is blank either way until this runs.
		//
		// `reduce` MUST be read here, synchronously — not inside the rAF callback or init.
		// Attachments run inside an effect, so this read registers the media query as a
		// reactive dependency: an OS reduce-motion toggle re-runs the attachment (cleanup,
		// then a fresh init in the new mode). A read inside the rAF callback is untracked
		// and would freeze the preference at its mount-time value until a full remount.
		const reduce = prefersReducedMotion.current;
		let cleanup: (() => void) | undefined;
		const raf = requestAnimationFrame(() => {
			cleanup = init(canvas, reduce);
		});
		return () => {
			cancelAnimationFrame(raf);
			cleanup?.();
		};
	}

	function init(canvas: HTMLCanvasElement, reduce: boolean) {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		// Give `c` a non-null DECLARED type: the guard above only narrows within this
		// scope, and the nested draw/resize/loop function declarations would otherwise
		// widen it back to `| null`. Binding to a typed const fixes that once.
		const c: CanvasRenderingContext2D = ctx;

		// Palette = the darcstar brand triad, read straight from the theme tokens so
		// the canvas never duplicates the hexes (single source of truth:
		// src/themes/darcstar.css). Order is charge R, G, B — matching the helix
		// strands and nebula glows below.
		const cs = getComputedStyle(document.documentElement);
		const triad = ['--color-tertiary-500', '--color-secondary-500', '--color-primary-500'].map(
			(v) => cs.getPropertyValue(v).trim()
		);
		// oklch(L C H) → oklch(L C H / a); the generated tokens are always alpha-less.
		const withAlpha = (col: string, a: number) => col.replace(/\)\s*$/, ` / ${a})`);

		let w = 0;
		let h = 0;
		// Vertical centre + height of the gap the helix sits in, in document coords
		// (scroll-invariant). Measured from the hero's #helix-slot; 0 = use fallback.
		let slotCy = 0;
		let slotH = 0;

		function mulberry32(seed: number) {
			return () => {
				seed |= 0;
				seed = (seed + 0x6d2b79f5) | 0;
				let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
		}
		const srand = mulberry32(0x9e3779b9);
		const stars = Array.from({ length: 150 }, () => ({
			x: srand(),
			y: srand(),
			r: srand() * 1.1 + 0.25,
			base: srand() * 0.5 + 0.18,
			tw: srand() * Math.PI * 2,
			sp: srand() * 0.5 + 0.25
		}));

		let lastT = 0;
		let dpr = 1;

		// Static-layer cache: the black base + the three nebula glows are identical every
		// frame, so render them ONCE per resize into an offscreen canvas and blit that
		// each frame — instead of rebuilding 3 radial gradients and filling the viewport
		// 4× per frame. The vignette must sit ON TOP of the helix, so it stays a per-frame
		// fill, but its gradient object is cached too (no per-frame createRadialGradient).
		const bg = document.createElement('canvas');
		const bgc = bg.getContext('2d');
		let vignette: CanvasGradient | null = null;

		// A second cache — the FULL static backdrop with the starfield FROZEN and no helix
		// (black + glows + steady stars + vignette). Used only once the hero has scrolled
		// away: the helix keeps turning, but instead of repainting the whole viewport (which
		// forces every glass panel to re-blur) we restore just the helix's strip from this
		// frame and redraw the helix there — so the canvas's dirty region, and the panels
		// that re-blur, shrink to that band. Stars stop twinkling while scrolled because
		// their per-frame change is what would otherwise dirty the whole canvas.
		// Built LAZILY (staticFrameDirty → renderStaticFrame in drawHelixOnly): on first load
		// the hero is visible and this cache is never read, so composing it eagerly was pure
		// main-thread waste in the page's busiest window (DAR-50).
		const staticFrame = document.createElement('canvas');
		const sfc = staticFrame.getContext('2d');
		let staticFrameDirty = true;
		let freezePending = false;

		function makeVignette(x: CanvasRenderingContext2D) {
			const cy = helixCenter();
			const g = x.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.62);
			g.addColorStop(0, 'rgba(0,0,0,0)');
			g.addColorStop(1, 'rgba(0,0,0,0.5)');
			return g;
		}

		// Paint the starfield into `ctx`. `alphaOf` gives each star's opacity — a steady
		// `st.base` for the frozen cache, `st.base × twinkle` for the live frame — so the two
		// star passes share one arc/fill loop. Resets globalAlpha to 1 when done.
		function drawStars(
			ctx: CanvasRenderingContext2D,
			alphaOf: (st: (typeof stars)[number]) => number
		) {
			for (const st of stars) {
				ctx.globalAlpha = Math.max(0, alphaOf(st));
				ctx.beginPath();
				ctx.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2);
				ctx.fillStyle = '#ffffff';
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		}

		function renderBackground() {
			bg.width = canvas.width;
			bg.height = canvas.height;
			// staticFrame derives from bg — mark it stale BEFORE the context guard, so even a
			// degraded (!bgc) resize re-arms the rebuild and the frozen frame can't keep stale
			// dimensions. renderStaticFrame clears it unconditionally for the same reason.
			staticFrameDirty = true;
			if (!bgc) return;

			// bg = black + the three nebula glows.
			bgc.setTransform(dpr, 0, 0, dpr, 0, 0);
			bgc.fillStyle = '#000000';
			bgc.fillRect(0, 0, w, h);
			const glows = [
				{ x: w * 0.26, y: h * 0.3, col: withAlpha(triad[0], 0.13) },
				{ x: w * 0.74, y: h * 0.28, col: withAlpha(triad[1], 0.13) },
				{ x: w * 0.5, y: h * 0.74, col: withAlpha(triad[2], 0.13) }
			];
			const rad = Math.max(w, h) * 0.42;
			for (const g of glows) {
				const grd = bgc.createRadialGradient(g.x, g.y, 0, g.x, g.y, rad);
				grd.addColorStop(0, g.col);
				grd.addColorStop(1, 'transparent');
				bgc.fillStyle = grd;
				bgc.fillRect(0, 0, w, h);
			}
			// Vignette gradient tracks the helix centre; only a resize moves it. Painted
			// on top of the helix in draw().
			vignette = makeVignette(c);
		}

		// staticFrame = bg + frozen (steady) stars + vignette — the helix-less backdrop
		// the scrolled-away path restores the helix strip from each frame.
		function renderStaticFrame() {
			// Clear the flag UNCONDITIONALLY, before the context guard: a canvas whose 2d
			// context failed never gets one later, so bailing with the flag still set would
			// re-run this — including the width/height assignment, a full backing-store
			// realloc — on every drawHelixOnly frame, on exactly the memory-strained devices
			// where sfc is most likely to be null. Cleared-but-blank degrades to the old
			// uniform-blank output.
			staticFrameDirty = false;
			staticFrame.width = canvas.width;
			staticFrame.height = canvas.height;
			if (!sfc) return;
			sfc.setTransform(1, 0, 0, 1, 0, 0);
			sfc.drawImage(bg, 0, 0);
			sfc.setTransform(dpr, 0, 0, dpr, 0, 0);
			drawStars(sfc, (st) => st.base);
			sfc.fillStyle = makeVignette(sfc);
			sfc.fillRect(0, 0, w, h);
		}

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = window.innerWidth;
			h = window.innerHeight;
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
			c.setTransform(dpr, 0, 0, dpr, 0, 0);
			// Re-measure the helix slot here rather than per frame: its centre is
			// scroll-invariant (rect.top + scrollY), so only a resize/reflow moves it.
			measureSlot();
			// Rebuild the cached backgrounds at the new size, then redraw one frame in the
			// current mode (a paused / reduced-motion backdrop would otherwise be left blank
			// after a resize; a running loop simply repaints again on its next tick).
			renderBackground();
			if (heroVisible || reduce) draw(lastT);
			else {
				freezePending = true;
				drawHelixOnly(lastT);
			}
		}

		// The empty flex-1 gap between the kicker and the headline panel. Using
		// rect.top + scrollY keeps the measurement scroll-invariant, so the fixed
		// helix aligns with the gap on first load and stays put while scrolling.
		function measureSlot() {
			const el = document.getElementById('helix-slot');
			if (!el) {
				slotCy = 0;
				slotH = 0;
				return;
			}
			const r = el.getBoundingClientRect();
			slotCy = r.top + window.scrollY + r.height / 2;
			slotH = r.height;
		}

		const helixCenter = () => slotCy || Math.min(h * 0.42, 360);

		// Shared helix geometry — centre, span, left edge, amplitude. drawHelix() and
		// helixBBox() both derive from these, so the drawn braid and the band it repaints
		// can't drift apart. Amplitude tracks the WIDTH (not viewport height), so the braid
		// keeps its aspect ratio and simply scales down on narrow screens; capped to the gap.
		function helixGeom() {
			const span = Math.min(w * 0.94, 1180);
			return {
				cy: helixCenter(),
				span,
				x0: w / 2 - span / 2,
				amp: Math.min(span * 0.11, (slotH || h * 0.5) * 0.42)
			};
		}

		function drawHelix(t: number) {
			if (w < 360) return; // extra-small only — drop it (matches the min-[360px] gap collapse)
			const { cy, span, x0, amp } = helixGeom();
			const turns = 2.3;
			const N = 66;
			const phase = t * 0.0002;

			const segs: { x0: number; y0: number; x1: number; y1: number; z: number; col: string }[] = [];
			for (let i = 0; i < N; i++) {
				const t0 = i / N;
				const t1 = (i + 1) / N;
				const e0 = Math.sin(Math.PI * t0);
				const e1 = Math.sin(Math.PI * t1);
				for (let s = 0; s < 3; s++) {
					const off = (s * 2 * Math.PI) / 3;
					const a0 = t0 * turns * 2 * Math.PI + phase + off;
					const a1 = t1 * turns * 2 * Math.PI + phase + off;
					segs.push({
						x0: x0 + t0 * span,
						y0: cy + amp * e0 * Math.sin(a0),
						x1: x0 + t1 * span,
						y1: cy + amp * e1 * Math.sin(a1),
						z: Math.cos((a0 + a1) / 2),
						col: triad[s]
					});
				}
			}
			segs.sort((a, b) => a.z - b.z);

			c.globalCompositeOperation = 'lighter';
			c.lineCap = 'round';
			for (const sg of segs) {
				const zz = (sg.z + 1) / 2; // 0 back .. 1 front
				const alpha = 0.14 + 0.86 * zz;
				const width = 0.6 + 2.1 * zz;
				c.strokeStyle = sg.col;
				c.beginPath();
				c.moveTo(sg.x0, sg.y0);
				c.lineTo(sg.x1, sg.y1);
				// Front strands get a soft halo — a wide, faint additive stroke under the
				// bright core — approximating the glow far more cheaply than the previous
				// per-segment `shadowBlur` (the priciest 2D op, run ~99×/frame).
				if (zz > 0.5) {
					c.globalAlpha = alpha * 0.2;
					c.lineWidth = width + 7 * zz;
					c.stroke();
				}
				c.globalAlpha = alpha;
				c.lineWidth = width;
				c.stroke();
			}
			c.globalAlpha = 1;
			c.globalCompositeOperation = 'source-over';
		}

		function draw(t: number) {
			lastT = t;

			// Blit the cached static background (black + nebula glows) 1:1 in device px.
			// It's an opaque base, so it doubles as the frame clear; then restore the DPR
			// transform for the dynamic layers.
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.drawImage(bg, 0, 0);
			c.setTransform(dpr, 0, 0, dpr, 0, 0);

			drawStars(
				c,
				(st) => st.base * (reduce ? 1 : 0.55 + 0.45 * Math.sin(t * 0.001 * st.sp + st.tw))
			);

			drawHelix(t);

			// Vignette on top of the helix (cached gradient — see renderBackground).
			if (vignette) {
				c.fillStyle = vignette;
				c.fillRect(0, 0, w, h);
			}
		}

		// The helix's bounding band (full width × the strand amplitude), padded for the
		// stroke + additive glow so nothing trails outside when we repaint only this region.
		function helixBBox() {
			const { cy, span, x0, amp } = helixGeom();
			const pad = 14;
			const x = Math.max(0, x0 - pad);
			const y = Math.max(0, cy - amp - pad);
			return {
				x,
				y,
				width: Math.min(w - x, span + 2 * pad),
				height: Math.min(h - y, 2 * amp + 2 * pad)
			};
		}

		// Scrolled past the hero: keep the helix turning but freeze everything else. Restore
		// only the previous helix band from the frozen staticFrame and redraw the helix
		// there (clipped) — so the canvas's dirty region is that band, not the whole
		// viewport, and only panels overlapping the band re-blur.
		function drawHelixOnly(t: number) {
			lastT = t;
			// Lazy rebuild costs ~one extra draw()'s worth on this single tick — inside the
			// 24fps frame budget. If a low-end-device profile ever shows a hitch here, build
			// from the IntersectionObserver callback that sets freezePending instead, so the
			// compose and the freeze blit land on separate ticks.
			if (staticFrameDirty) renderStaticFrame();
			if (freezePending) {
				// First frame after leaving the hero: lay down one clean frozen full frame
				// (whole starfield consistent) before switching to strip-only repaints.
				freezePending = false;
				c.setTransform(1, 0, 0, 1, 0, 0);
				c.drawImage(staticFrame, 0, 0);
				c.setTransform(dpr, 0, 0, dpr, 0, 0);
				drawHelix(t);
				return;
			}
			const b = helixBBox();
			const sx = Math.floor(b.x * dpr);
			const sy = Math.floor(b.y * dpr);
			const sw = Math.ceil(b.width * dpr);
			const sh = Math.ceil(b.height * dpr);
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.drawImage(staticFrame, sx, sy, sw, sh, sx, sy, sw, sh);
			c.setTransform(dpr, 0, 0, dpr, 0, 0);
			c.save();
			c.beginPath();
			c.rect(b.x, b.y, b.width, b.height);
			c.clip();
			drawHelix(t);
			c.restore();
		}

		// Ambient motion is slow, so cap the redraw at ~24fps (well under a 60/120Hz
		// display — imperceptible for motion this slow) and pause entirely while hidden.
		const frameMs = 1000 / 24;
		let raf = 0;
		let lastDraw = 0;
		function loop(t: number) {
			raf = requestAnimationFrame(loop);
			if (t - lastDraw < frameMs) return;
			lastDraw = t;
			// In the hero: full draw (twinkling stars + helix). Scrolled past: cheap
			// helix-only path (frozen stars, only the helix band repaints).
			if (heroVisible) draw(t);
			else drawHelixOnly(t);
		}
		// Raw rAF controls; `sync()` decides whether the loop SHOULD be running.
		function start() {
			if (!raf) raf = requestAnimationFrame(loop);
		}
		function stop() {
			if (raf) {
				cancelAnimationFrame(raf);
				raf = 0;
			}
		}

		// The loop runs whenever motion is allowed, the tab is visible, and the contact
		// modal is closed. `heroVisible` does NOT gate running — it switches the DRAW MODE
		// (full vs. the cheap helix-only path): scrolled past the hero the helix keeps
		// turning, but frozen stars + a strip-only repaint stop the glass panels from
		// re-blurring the whole canvas every frame.
		let heroVisible = true;
		// Seed from the dialog's CURRENT state, not false: the $effect bridge below fired
		// before this deferred init assigned setModalOpen (a plain let — assigning it can't
		// re-fire the effect), so a backdrop mounting under an already-open modal (client-side
		// nav with the dialog up; nothing closes it on navigate) would otherwise start
		// unpaused. The read is untracked here (we're in a rAF callback) — deliberately: init
		// must not become reactive; the $effect pushes every later toggle via setModalOpen.
		let modalOpen = contactDialog.open;
		function runnable() {
			return !reduce && !document.hidden && !modalOpen;
		}
		function sync() {
			if (runnable()) start();
			else stop();
		}
		// Driven by the component-level $effect below (see the bridge note up top).
		setModalOpen = (open: boolean) => {
			modalOpen = open;
			sync();
		};

		// slotCy only shifts on layout changes, so re-measure on resize/scroll instead
		// of every frame (on mobile, URL-bar reflow can surface as a scroll event).
		function onScroll() {
			measureSlot();
			if (reduce) draw(lastT);
		}

		resize();
		window.addEventListener('resize', resize);
		window.addEventListener('scroll', onScroll, { passive: true });
		// The rAF loop already stalls in background tabs; syncing on visibilitychange
		// stops the per-frame work explicitly and makes the intent clear.
		document.addEventListener('visibilitychange', sync);

		// Switch to the cheap helix-only draw the moment the hero <section> (kicker + helix
		// gap + headline/CTA panel) fully leaves the viewport — so the star twinkle runs
		// through the whole hero, then freezes — and back to the full draw on return. No
		// margin: freezing the (imperceptible) twinkle any later just wastes GPU on the
		// content below. No hero (e.g. the error page) → stays in full mode.
		const heroRegion = document.getElementById('helix-slot')?.closest('section');
		let io: IntersectionObserver | undefined;
		if (heroRegion) {
			io = new IntersectionObserver(
				([entry]) => {
					const vis = entry.isIntersecting;
					// Leaving the hero → flag one clean frozen frame before the strip-only path.
					if (heroVisible && !vis) freezePending = true;
					heroVisible = vis;
					sync();
				},
				{ rootMargin: '0px' }
			);
			io.observe(heroRegion);
		}

		sync();

		return () => {
			stop();
			setModalOpen = undefined;
			io?.disconnect();
			window.removeEventListener('resize', resize);
			window.removeEventListener('scroll', onScroll);
			document.removeEventListener('visibilitychange', sync);
		};
	}

	// Pause the backdrop while the contact modal is open (see the bridge note up top).
	$effect(() => {
		setModalOpen?.(contactDialog.open);
	});
</script>

<canvas
	{@attach backdrop}
	class="pointer-events-none fixed inset-0 -z-10 h-full w-full"
	aria-hidden="true"
></canvas>
