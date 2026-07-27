<script lang="ts">
	// Site footer (issue #12) — the baseline trust signals a real company shows:
	// legal name + © year, location, secondary nav, and social/contact links.
	// Rendered once in +layout.svelte, so it appears on every page below <main>.
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { CONTACT_EMAIL } from '$lib/site';
	import {
		FALLBACK_SOCIAL_LINKS,
		socialIconKey,
		type SocialIconKey,
		type SocialLink
	} from '$lib/social-links';
	import Wordmark from './Wordmark.svelte';
	import Icon from './Icon.svelte';

	// The social row comes from the Studio's `siteSettings.socialLinks` (DAR-73), handed down by the
	// root layout as `page.data.socialLinks`. It arrives as a PROP rather than being read from
	// `page.data` here (the way Header.svelte reads the auth snapshot) for two reasons: Footer has a
	// Storybook story that renders it with no page context, and a prop is what makes the fallback
	// path unit-testable. The default is the same floor the server uses, so a caller that passes
	// nothing still renders the GitHub link rather than an empty row.
	let { socialLinks = FALLBACK_SOCIAL_LINKS }: { socialLinks?: readonly SocialLink[] } = $props();

	// Rendered at request time (SSR) — no hydration mismatch since client agrees.
	const year = new Date().getFullYear();

	// Secondary nav for the single-page site: home + the GIDE section anchor
	// (prefixed with the localized home path so it resolves from any page).
	// localizeHref keeps internal links locale-correct; `$derived` so the labels
	// track the active locale. Contact is a separate button that opens the contact
	// modal (issue #11); the footer email icon below stays a direct mailto.
	// `preload: 'tap'` opts a link out of the body-wide `hover` prefetch. Only /waitlist needs it, and
	// for a measurement reason rather than a performance one: that page's load records the funnel's
	// `waitlist_viewed` event (DAR-66), so a hover prefetch would count a view for a page the visitor
	// never opened — and this footer is on EVERY page, so incidental mouse drift over it would be a
	// standing inflation of the primary conversion metric's denominator. On pointerdown the fetch still
	// starts before the navigation, and a click reuses it, so a real visitor is fetched once and
	// counted once.
	type FooterLink = { label: string; href: string; preload?: 'tap' };
	const nav: FooterLink[] = $derived([
		{ label: m.footer_nav_home(), href: localizeHref('/') },
		{ label: m.footer_nav_gide(), href: `${localizeHref('/')}#gide` },
		{ label: m.footer_nav_evidence(), href: localizeHref('/evidence') },
		{ label: m.footer_nav_waitlist(), href: localizeHref('/waitlist'), preload: 'tap' }
	]);
</script>

<!-- One button per profile. `icon` is a SocialIconKey (chosen from the URL's host, so a relabelled
     entry can't lose its mark) plus 'email' for the mailto, which is a contact route rather than a
     social profile and so never comes from the CMS. Brand marks are FILLED glyphs (not the stroked
     <Icon>); only the generic fallback uses it — see Icon.svelte's note. -->
{#snippet socialLink(href: string, icon: SocialIconKey | 'email', label: string, external: boolean)}
	<a
		{href}
		aria-label={label}
		rel={external ? 'noreferrer' : null}
		target={external ? '_blank' : null}
		class="glass-btn flex size-10 items-center justify-center rounded-lg text-body hover-focus:text-white"
	>
		{#if icon === 'github'}
			<svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"
				/>
			</svg>
		{:else if icon === 'linkedin'}
			<svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"
				/>
			</svg>
		{:else if icon === 'bluesky'}
			<svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 10.8C10.91 8.69 7.95 4.75 5.2 2.81 2.57.94 1.56 1.27.9 1.57.14 1.91 0 3.08 0 3.77c0 .69.38 5.65.62 6.48.82 2.73 3.71 3.66 6.39 3.36.13-.02.27-.04.41-.06-.14.02-.28.04-.41.06-3.92.58-7.39 2-2.83 7.08 5.01 5.19 6.87-1.12 7.82-4.31.95 3.19 2.05 9.27 7.73 4.31 4.27-4.31 1.18-6.5-2.74-7.08-.14-.02-.27-.04-.41-.06.14.02.28.04.41.06 2.67.3 5.57-.63 6.38-3.36.25-.83.63-5.79.63-6.48 0-.69-.14-1.86-.9-2.2-.66-.3-1.67-.63-4.3 1.24C16.05 4.75 13.09 8.69 12 10.8z"
				/>
			</svg>
		{:else if icon === 'email'}
			<Icon class="size-5" strokeWidth={1.5}>
				<rect x="3" y="5" width="18" height="14" rx="2" />
				<path d="m3 7 9 6 9-6" />
			</Icon>
		{:else}
			<!-- A platform we ship no mark for. A generic link glyph keeps the button legible
			     instead of rendering an empty square. -->
			<Icon class="size-5" strokeWidth={1.5}>
				<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
				<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
			</Icon>
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
					<!-- Editor order is preserved. The label is the CMS string, used as the accessible
					     name — a proper noun, so deliberately not a Paraglide message (see $lib/site.ts). -->
					{#each socialLinks as link (link.url)}
						{@render socialLink(link.url, socialIconKey(link.url), link.label, true)}
					{/each}
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
								data-sveltekit-preload-data={link.preload}
								class="text-sm text-body transition-colors hover-focus:text-primary-500"
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
							class="text-sm text-body transition-colors hover-focus:text-primary-500"
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
			<!-- Legal links (DAR-44) share the line with the location; "·" is decoration-only
			     (no letters), so the no-raw-text rule permits the literal. -->
			<p class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<a href={localizeHref('/privacy')} class="transition-colors hover-focus:text-primary-500"
					>{m.footer_legal_privacy()}</a
				>
				<span aria-hidden="true">·</span>
				<a href={localizeHref('/terms')} class="transition-colors hover-focus:text-primary-500"
					>{m.footer_legal_terms()}</a
				>
				<span aria-hidden="true">·</span>
				<span>{m.footer_location()}</span>
			</p>
		</div>
	</div>
</footer>
