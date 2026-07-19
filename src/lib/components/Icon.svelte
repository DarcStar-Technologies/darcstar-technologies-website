<script lang="ts">
	// Shared wrapper for the stroke-based line icons used across the UI (chevron, close,
	// hamburger, check, arrow, mail). Only the size and the inner <path>/<rect> shapes differ,
	// so callers pass the shapes as children and a size via `class`; `strokeWidth` defaults to
	// 2 (a couple of icons want 1.5 or 2.5). Decorative by default — `aria-hidden`, because the
	// accessible name comes from the parent control's aria-label or adjacent text. NOT for
	// filled brand glyphs (e.g. Footer's GitHub mark), which are `fill`ed rather than stroked.
	import type { Snippet } from 'svelte';

	let {
		class: klass,
		strokeWidth = 2,
		children
	}: { class?: string; strokeWidth?: number; children: Snippet } = $props();
</script>

<svg
	class={klass}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{@render children()}
</svg>
