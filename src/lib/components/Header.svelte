<script lang="ts">
	import { slide } from 'svelte/transition';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { loginDialog } from '$lib/login-dialog.svelte';
	import Wordmark from './Wordmark.svelte';
	import Icon from './Icon.svelte';

	// Nav links — plain localized path links (About now points at the real /about page,
	// issue #61; the old `/#about` footer-anchor workaround is retired). `$derived` so
	// hrefs + labels track the active locale; `id` is a stable {#each} key across switches.
	const links = $derived([
		{ id: 'home', label: m.nav_home(), href: localizeHref('/') },
		{ id: 'about', label: m.nav_about(), href: localizeHref('/about') }
	]);

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

<!-- One link markup for both the desktop and mobile lists; `className` carries the
     per-list styling so the two never drift. Plain path links now, so the click only
     closes the mobile menu (the router handles navigation). -->
{#snippet navLink(link: { id: string; label: string; href: string }, className: string)}
	<a href={link.href} onclick={() => (open = false)} class={className}>
		{link.label}
	</a>
{/snippet}

<!-- Login link: a real /login anchor (the no-JS fallback), upgraded when JS is present to open
     the frosted login dialog instead of navigating (issue #69). Same markup for both nav lists. -->
{#snippet loginLink(className: string)}
	<a
		href={localizeHref('/login')}
		data-sveltekit-preload-data="off"
		onclick={(e) => {
			// Honour modified clicks (⌘/Ctrl/Shift/Alt) — let the browser follow the href (e.g.
			// open /login in a new tab) rather than the dialog. A plain left-click with JS opens
			// the frosted dialog; with no JS the click falls through to the href.
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			e.preventDefault();
			open = false;
			loginDialog.show();
		}}
		class={className}
	>
		{m.nav_login()}
	</a>
{/snippet}

<!-- Sticky-detection sentinel: out of flow at the document top (no layout shift), it
     scrolls out of view as the header sticks, flipping `stuck` → the shadow-on-scroll. -->
<div
	{@attach stickWatch}
	aria-hidden="true"
	class="pointer-events-none absolute top-0 left-0 h-px w-px"
></div>

<header class="sticky top-0 z-50 px-4 pt-[var(--header-gap-top)]">
	<nav
		class="glass-nav mx-auto max-w-5xl rounded-2xl px-4"
		data-stuck={stuck}
		aria-label={m.nav_primary_label()}
	>
		<div class="flex h-[var(--header-bar-h)] items-center justify-between gap-6">
			<a
				href={localizeHref('/')}
				onclick={() => (open = false)}
				class="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white sm:text-4xl"
			>
				<Wordmark markClass="size-20" />
			</a>

			<div class="flex items-center gap-2 sm:gap-4">
				<!-- Desktop links -->
				<ul class="hidden items-center gap-1 sm:flex">
					{#each links as link (link.id)}
						<li>
							{@render navLink(
								link,
								'rounded px-3 py-2 text-sm font-medium text-surface-700-300 transition-colors hover:text-primary-500'
							)}
						</li>
					{/each}
					<li>
						{@render loginLink(
							'rounded px-3 py-2 text-sm font-medium text-surface-700-300 transition-colors hover:text-primary-500'
						)}
					</li>
				</ul>

				<!-- Mobile menu toggle -->
				<button
					type="button"
					class="btn-icon hover:preset-tonal sm:hidden"
					aria-label={open ? m.nav_menu_close() : m.nav_menu_open()}
					aria-expanded={open}
					aria-controls="mobile-nav"
					onclick={() => (open = !open)}
				>
					{#if open}
						<Icon class="size-6">
							<path d="M18 6 6 18M6 6l12 12" />
						</Icon>
					{:else}
						<Icon class="size-6">
							<path d="M3 6h18M3 12h18M3 18h18" />
						</Icon>
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
				{#each links as link (link.id)}
					<li>
						{@render navLink(
							link,
							'block rounded px-3 py-2 text-base font-medium text-surface-700-300 transition-colors hover:preset-tonal-primary'
						)}
					</li>
				{/each}
				<li>
					{@render loginLink(
						'block rounded px-3 py-2 text-base font-medium text-surface-700-300 transition-colors hover:preset-tonal-primary'
					)}
				</li>
			</ul>
		{/if}
	</nav>
</header>
