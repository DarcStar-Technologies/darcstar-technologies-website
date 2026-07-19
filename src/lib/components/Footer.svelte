<script lang="ts">
	// Site footer (issue #12) — the baseline trust signals a real company shows:
	// legal name + © year, location, secondary nav, and social/contact links.
	// Rendered once in +layout.svelte, so it appears on every page below <main>.
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { CONTACT_EMAIL, GITHUB_URL } from '$lib/site';
	import Wordmark from './Wordmark.svelte';

	// Rendered at request time (SSR) — no hydration mismatch since client agrees.
	const year = new Date().getFullYear();

	// Secondary nav for the single-page site: home + the GIDE section anchor
	// (prefixed with the localized home path so it resolves from any page).
	// localizeHref keeps internal links locale-correct; `$derived` so the labels
	// track the active locale. Contact is a separate button that opens the contact
	// modal (issue #11); the footer email icon below stays a direct mailto.
	const nav = $derived([
		{ label: m.footer_nav_home(), href: localizeHref('/') },
		{ label: m.footer_nav_gide(), href: `${localizeHref('/')}#gide` }
	]);
</script>

{#snippet socialLink(href: string, icon: string, label: string, external: boolean)}
	<a
		{href}
		aria-label={label}
		rel={external ? 'noreferrer' : null}
		target={external ? '_blank' : null}
		class="glass-btn flex size-10 items-center justify-center rounded-lg text-body hover:text-white"
	>
		{#if icon === 'github'}
			<svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"
				/>
			</svg>
		{:else if icon === 'email'}
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

<footer class="border-t border-hairline bg-white/[0.02]">
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
				<p class="mt-4 text-sm text-body">
					{m.footer_tagline()}
				</p>
				<div class="mt-5 flex gap-3">
					{@render socialLink(GITHUB_URL, 'github', m.footer_social_github(), true)}
					{@render socialLink(`mailto:${CONTACT_EMAIL}`, 'email', m.footer_social_email(), false)}
				</div>
			</div>

			<!-- Secondary nav -->
			<nav aria-label={m.footer_nav_label()}>
				<h2 class="eyebrow text-xs tracking-widest">
					{m.footer_nav_heading()}
				</h2>
				<ul class="mt-4 space-y-2.5">
					{#each nav as link (link.label)}
						<li>
							<a
								href={link.href}
								class="text-sm text-body transition-colors hover:text-primary-500"
							>
								{link.label}
							</a>
						</li>
					{/each}
					<li>
						<button
							type="button"
							aria-haspopup="dialog"
							onclick={() => contactDialog.show()}
							class="text-sm text-body transition-colors hover:text-primary-500"
						>
							{m.footer_nav_contact()}
						</button>
					</li>
				</ul>
			</nav>
		</div>

		<!-- Legal bar -->
		<div
			class="mt-10 flex flex-col gap-1.5 border-t border-hairline pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between"
		>
			<p>{m.footer_copyright({ year: String(year) })}</p>
			<p>{m.footer_location()}</p>
		</div>
	</div>
</footer>
