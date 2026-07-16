<script lang="ts">
	import { slide } from 'svelte/transition';
	import { localizeHref } from '$lib/paraglide/runtime';
	import favicon from '$lib/assets/favicon.svg';

	// Starter links point to existing routes; replace with real nav as the site grows.
	const links = [{ label: 'Home', href: '/' }];

	let open = $state(false);
	let stuck = $state(false);

	// The header lifts its shadow only once it detaches from the top of the page. The
	// sentinel below sits at the document top; IntersectionObserver flips `stuck` as it
	// scrolls out of view — no per-scroll handler, only a fire at the crossing.
	function stickWatch(node: HTMLElement) {
		const io = new IntersectionObserver(([entry]) => (stuck = !entry.isIntersecting));
		io.observe(node);
		return () => io.disconnect();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
/>

<!-- Sticky-detection sentinel: out of flow at the document top (no layout shift), it
     scrolls out of view as the header sticks, flipping `stuck` → the shadow-on-scroll. -->
<div
	{@attach stickWatch}
	aria-hidden="true"
	class="pointer-events-none absolute top-0 left-0 h-px w-px"
></div>

<header class="sticky top-0 z-50 px-4 pt-3">
	<nav class="glass-nav mx-auto max-w-5xl rounded-2xl px-4" data-stuck={stuck} aria-label="Primary">
		<div class="flex h-24 items-center justify-between gap-6">
			<a
				href={localizeHref('/')}
				onclick={() => (open = false)}
				class="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white sm:text-4xl"
			>
				<img src={favicon} alt="" class="size-20" />
				<span>DarcStar <span class="charge-flow">Technologies</span></span>
			</a>

			<div class="flex items-center gap-2 sm:gap-4">
				<!-- Desktop links -->
				<ul class="hidden items-center gap-1 sm:flex">
					{#each links as link (link.href)}
						<li>
							<a
								href={localizeHref(link.href)}
								class="rounded px-3 py-2 text-sm font-medium text-surface-700-300 transition-colors hover:text-primary-500"
							>
								{link.label}
							</a>
						</li>
					{/each}
				</ul>

				<!-- Mobile menu toggle -->
				<button
					type="button"
					class="btn-icon hover:preset-tonal sm:hidden"
					aria-label={open ? 'Close menu' : 'Open menu'}
					aria-expanded={open}
					aria-controls="mobile-nav"
					onclick={() => (open = !open)}
				>
					{#if open}
						<svg
							class="size-6"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					{:else}
						<svg
							class="size-6"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M3 6h18M3 12h18M3 18h18" />
						</svg>
					{/if}
				</button>
			</div>
		</div>

		<!-- Mobile links -->
		{#if open}
			<ul
				id="mobile-nav"
				class="flex flex-col gap-1 pb-3 sm:hidden"
				transition:slide={{ duration: 150 }}
			>
				{#each links as link (link.href)}
					<li>
						<a
							href={localizeHref(link.href)}
							onclick={() => (open = false)}
							class="block rounded px-3 py-2 text-base font-medium text-surface-700-300 transition-colors hover:preset-tonal-primary"
						>
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</nav>
</header>
