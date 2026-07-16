<script lang="ts">
	// Fixed, full-viewport decorative canvas: the cosmic void (dark-only site).
	// Black + nebula glows + a persistent starfield + a twisting triple helix that
	// stays fixed in the background as the page scrolls. The helix scales as a rigid
	// unit (amplitude tracks its width) and centres in the hero's #helix-slot gap.
	// Respects prefers-reduced-motion.
	import { prefersReducedMotion } from 'svelte/motion';

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

		function resize() {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = window.innerWidth;
			h = window.innerHeight;
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
			c.setTransform(dpr, 0, 0, dpr, 0, 0);
			// Re-measure the helix slot here rather than per frame: its centre is
			// scroll-invariant (rect.top + scrollY), so only a resize/reflow moves it.
			measureSlot();
			if (reduce) draw(lastT);
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
				c.strokeStyle = sg.col;
				c.globalAlpha = 0.14 + 0.86 * zz;
				c.lineWidth = 0.6 + 2.1 * zz;
				if (zz > 0.5) {
					c.shadowBlur = 9 * zz;
					c.shadowColor = sg.col;
				} else {
					c.shadowBlur = 0;
				}
				c.beginPath();
				c.moveTo(sg.x0, sg.y0);
				c.lineTo(sg.x1, sg.y1);
				c.stroke();
			}
			c.globalAlpha = 1;
			c.shadowBlur = 0;
			c.globalCompositeOperation = 'source-over';
		}

		function draw(t: number) {
			lastT = t;
			c.clearRect(0, 0, w, h);

			c.fillStyle = '#000000';
			c.fillRect(0, 0, w, h);

			const glows = [
				{ x: w * 0.26, y: h * 0.3, col: withAlpha(triad[0], 0.13) },
				{ x: w * 0.74, y: h * 0.28, col: withAlpha(triad[1], 0.13) },
				{ x: w * 0.5, y: h * 0.74, col: withAlpha(triad[2], 0.13) }
			];
			const rad = Math.max(w, h) * 0.42;
			for (const g of glows) {
				const grd = c.createRadialGradient(g.x, g.y, 0, g.x, g.y, rad);
				grd.addColorStop(0, g.col);
				grd.addColorStop(1, 'transparent');
				c.fillStyle = grd;
				c.fillRect(0, 0, w, h);
			}

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

			const cy = helixCenter();
			const vg = c.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.62);
			vg.addColorStop(0, 'rgba(0,0,0,0)');
			vg.addColorStop(1, 'rgba(0,0,0,0.5)');
			c.fillStyle = vg;
			c.fillRect(0, 0, w, h);
		}

		// Ambient motion is slow, so cap the redraw at ~30fps (halves the work vs. a
		// 60/120Hz display) and pause entirely while the tab is hidden.
		const frameMs = 1000 / 30;
		let raf = 0;
		let lastDraw = 0;
		function loop(t: number) {
			raf = requestAnimationFrame(loop);
			if (t - lastDraw < frameMs) return;
			lastDraw = t;
			draw(t);
		}
		function start() {
			if (!raf && !reduce) raf = requestAnimationFrame(loop);
		}
		function stop() {
			if (raf) {
				cancelAnimationFrame(raf);
				raf = 0;
			}
		}

		// slotCy only shifts on layout changes, so re-measure on resize/scroll instead
		// of every frame (on mobile, URL-bar reflow can surface as a scroll event).
		function onScroll() {
			measureSlot();
			if (reduce) draw(lastT);
		}
		// The rAF loop already stalls in background tabs; stopping explicitly frees the
		// per-frame canvas work regardless and makes the intent clear.
		function onVisibility() {
			if (document.hidden) stop();
			else start();
		}

		resize();
		window.addEventListener('resize', resize);
		window.addEventListener('scroll', onScroll, { passive: true });
		document.addEventListener('visibilitychange', onVisibility);

		if (!reduce) start();

		return () => {
			stop();
			window.removeEventListener('resize', resize);
			window.removeEventListener('scroll', onScroll);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}
</script>

<canvas
	{@attach backdrop}
	class="pointer-events-none fixed inset-0 -z-10 h-full w-full"
	aria-hidden="true"
></canvas>
