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
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		// Give `c` a non-null DECLARED type: the guard above only narrows within this
		// scope, and the nested draw/resize/loop function declarations would otherwise
		// widen it back to `| null`. Binding to a typed const fixes that once.
		const c: CanvasRenderingContext2D = ctx;

		const reduce = prefersReducedMotion.current;

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

		function renderBackground() {
			bg.width = canvas.width;
			bg.height = canvas.height;
			if (!bgc) return;
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
			const cy = helixCenter();
			vignette = c.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.62);
			vignette.addColorStop(0, 'rgba(0,0,0,0)');
			vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
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
			// Rebuild the cached static background at the new size, then redraw one frame
			// (a paused / reduced-motion backdrop would otherwise be left blank after a
			// resize; a running loop simply repaints again on its next tick).
			renderBackground();
			draw(lastT);
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

		function drawHelix(t: number) {
			if (w < 360) return; // extra-small only — drop it (matches the min-[360px] gap collapse)
			const cx = w / 2;
			const cy = helixCenter();
			const span = Math.min(w * 0.94, 1180);
			const x0 = cx - span / 2;
			// Amplitude tracks the WIDTH (not viewport height), so the braid keeps its
			// aspect ratio and simply scales down on narrow screens; capped to the gap.
			const amp = Math.min(span * 0.11, (slotH || h * 0.5) * 0.42);
			const turns = 2.3;
			const N = 66;
			const phase = t * 0.0002;
			const colors = triad;

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
						col: colors[s]
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

			for (const st of stars) {
				const tw = reduce ? 1 : 0.55 + 0.45 * Math.sin(t * 0.001 * st.sp + st.tw);
				c.globalAlpha = Math.max(0, st.base * tw);
				c.beginPath();
				c.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2);
				c.fillStyle = '#ffffff';
				c.fill();
			}
			c.globalAlpha = 1;

			drawHelix(t);

			// Vignette on top of the helix (cached gradient — see renderBackground).
			if (vignette) {
				c.fillStyle = vignette;
				c.fillRect(0, 0, w, h);
			}
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
			draw(t);
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

		// The animation is only worth running while the hero (with the moving helix) is
		// on screen, the tab is visible, and motion isn't reduced. The real cost on this
		// page isn't the canvas itself but that every glass panel's backdrop-filter must
		// re-blur the canvas on each frame it changes; pausing once the hero scrolls away
		// freezes the backdrop so those panels stop re-compositing while you read below.
		let heroVisible = true;
		let modalOpen = false;
		function runnable() {
			return !reduce && !document.hidden && heroVisible && !modalOpen;
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

		// Pause the loop once the hero section scrolls out of view, resume on return. A
		// margin keeps it running just past the edge so there's no flicker at the
		// boundary. No hero (e.g. the error page) → stays always-on, as before.
		const heroRegion = document.getElementById('helix-slot')?.closest('section');
		let io: IntersectionObserver | undefined;
		if (heroRegion) {
			io = new IntersectionObserver(
				([entry]) => {
					heroVisible = entry.isIntersecting;
					sync();
				},
				{ rootMargin: '200px 0px 200px 0px' }
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
