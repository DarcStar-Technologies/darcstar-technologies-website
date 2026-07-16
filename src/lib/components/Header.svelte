<script lang="ts">
	import { slide } from 'svelte/transition';
	import { localizeHref } from '$lib/paraglide/runtime';
	import favicon from '$lib/assets/favicon.svg';

	// Starter links point to existing routes; replace with real nav as the site grows.
	const links = [{ label: 'Home', href: '/' }];

	let open = $state(false);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
/>

<header class="sticky top-0 z-50 px-4 pt-3">
	<nav class="glass-nav mx-auto max-w-5xl rounded-2xl px-4" aria-label="Primary">
		<div class="flex h-14 items-center justify-between gap-6">
			<a
				href={localizeHref('/')}
				onclick={() => (open = false)}
				class="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white"
			>
				<img src={favicon} alt="" class="logo-spin size-8" />
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
