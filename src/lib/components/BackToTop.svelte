<script lang="ts">
	import { fade } from 'svelte/transition';
	import { scrollY, innerHeight } from 'svelte/reactivity/window';
	import { scrollBehavior } from '$lib/scroll';
	import { m } from '$lib/paraglide/messages.js';

	// Floating "back to top" control, rendered once in +layout.svelte so it's on
	// every page. Appears only after the page is scrolled more than 2/3 of a
	// viewport from the top; clicking scrolls smoothly back to the top.
	//
	// scrollY/innerHeight are reactive window views — the threshold tracks the
	// CURRENT viewport height (so resize and mobile URL-bar changes just work),
	// with no manual scroll listener to wire up or tear down. Both are `undefined`
	// on the server, so `show` is false during SSR and the button only appears
	// client-side once the user scrolls past the threshold.
	const show = $derived((scrollY.current ?? 0) > (innerHeight.current ?? 0) * (2 / 3));

	function toTop() {
		window.scrollTo({ top: 0, behavior: scrollBehavior() });
	}
</script>

{#if show}
	<button
		type="button"
		onclick={toTop}
		aria-label={m.back_to_top()}
		transition:fade={{ duration: 150 }}
		class="glass-btn fixed right-5 bottom-5 z-40 flex size-11 items-center justify-center rounded-full text-emphasis hover:text-white sm:right-8 sm:bottom-8"
	>
		<svg
			class="size-5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M12 19V5M5 12l7-7 7 7" />
		</svg>
	</button>
{/if}
