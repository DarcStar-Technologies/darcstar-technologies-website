<script lang="ts">
	// The frosted panel every standalone utility page is built on: /login, /signup, /forgot-password,
	// /reset-password, /updates/confirm, /updates/unsubscribe, /contact and /waitlist.
	//
	// These pages have no hero — they are a single card centred in the viewport, which is what makes
	// them a family distinct from the `PageHero` surfaces (CLAUDE.md's one hero pattern). Eight files
	// carried the same two elements verbatim, and DAR-222 found the drift you would predict from that:
	// the lede under the heading is `mt-2` on /login and `mt-3` on the six others, a difference nobody
	// chose. The wrapper is one component now; the type scale inside it is the `heading-*` tiers.
	//
	// Deliberately NOT absorbing the eyebrow and heading. On half of these pages the eyebrow sits
	// outside a `{#if}` and each branch renders its own `<h1>` (an "invalid link" panel says something
	// different from a success panel), so a combined component would either force the eyebrow to be
	// repeated per branch or force the branches to flatten. `PanelHeading` covers the pages where the
	// three really are adjacent.
	import type { Snippet } from 'svelte';

	// `lg` is for a panel that holds a FORM with more than a couple of fields — /contact and the
	// /waitlist steps. Everything else is `sm`: a sign-in box that spans 32rem reads as an error page.
	//
	// `below` renders inside the centred section but OUTSIDE the frosted card. /waitlist is the only
	// caller and its reason is load-bearing rather than cosmetic: the restart control must not read as
	// a second CTA on DAR-64's one-CTA confirmation, and putting it on the card is exactly what would
	// make that a matter of interpretation. Naming the slot is what keeps the placement a decision.
	let {
		width = 'sm',
		children,
		below
	}: { width?: 'sm' | 'lg'; children: Snippet; below?: Snippet } = $props();
</script>

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div
		class="glass-card mx-auto w-full p-6 text-left sm:p-8 {width === 'lg'
			? 'max-w-lg'
			: 'max-w-sm'}"
	>
		{@render children()}
	</div>
	{@render below?.()}
</section>
