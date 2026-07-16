<script lang="ts">
	// Site footer (issue #12) — the baseline trust signals a real company shows:
	// legal name + © year, location, secondary nav, and social/contact links.
	// Rendered once in +layout.svelte, so it appears on every page below <main>.
	import { localizeHref } from '$lib/paraglide/runtime';
	import Wordmark from './Wordmark.svelte';

	// Rendered at request time (SSR) — no hydration mismatch since client agrees.
	const year = new Date().getFullYear();
	const email = 'mharris@darcstar.tech';
	const githubUrl = 'https://github.com/DarcStar-Technologies';

	// Secondary nav for the single-page site: home, the GIDE section anchor
	// (prefixed with the localized home path so it resolves from any page), and
	// the contact mailto. localizeHref keeps internal links locale-correct.
	const nav = [
		{ label: 'Home', href: localizeHref('/') },
		{ label: 'GIDE', href: `${localizeHref('/')}#gide` },
		{ label: 'Contact', href: `mailto:${email}` }
	];
</script>

{#snippet socialLink(href: string, label: string, external: boolean)}
	<a
		{href}
		aria-label={label}
		rel={external ? 'noreferrer' : null}
		target={external ? '_blank' : null}
		class="glass-btn flex size-10 items-center justify-center rounded-lg text-white/70 hover:text-white"
	>
		{#if label === 'GitHub'}
			<svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"
				/>
			</svg>
		{:else if label === 'Email'}
			<svg
				class="size-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<rect x="3" y="5" width="18" height="14" rx="2" />
				<path d="m3 7 9 6 9-6" />
			</svg>
		{/if}
	</a>
{/snippet}

<!-- id="about" is the header's About nav target; scroll-mt clears the sticky header. -->
<footer id="about" class="scroll-mt-24 border-t border-white/10 bg-white/[0.02]">
	<div class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
		<div class="flex flex-col gap-10 sm:flex-row sm:justify-between">
			<!-- Brand + tagline + socials -->
			<div class="max-w-xs">
				<a
					href={localizeHref('/')}
					class="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white"
				>
					<Wordmark markClass="size-9" />
				</a>
				<p class="mt-4 text-sm text-white/70">
					Real-time intelligent control with formal safety guarantees.
				</p>
				<div class="mt-5 flex gap-3">
					{@render socialLink(githubUrl, 'GitHub', true)}
					{@render socialLink(`mailto:${email}`, 'Email', false)}
				</div>
			</div>

			<!-- Secondary nav -->
			<nav aria-label="Footer">
				<h2 class="font-mono text-xs tracking-widest text-white/60 uppercase">Navigate</h2>
				<ul class="mt-4 space-y-2.5">
					{#each nav as link (link.label)}
						<li>
							<a
								href={link.href}
								class="text-sm text-white/70 transition-colors hover:text-primary-500"
							>
								{link.label}
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		</div>

		<!-- Legal bar -->
		<div
			class="mt-10 flex flex-col gap-1.5 border-t border-white/10 pt-6 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between"
		>
			<p>© {year} DarcStar Technologies · All rights reserved.</p>
			<p>United States</p>
		</div>
	</div>
</footer>
