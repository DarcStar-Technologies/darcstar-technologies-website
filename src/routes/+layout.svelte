<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon-16.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import ContactDialog from '$lib/components/ContactDialog.svelte';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { syncGlassSheen } from '$lib/glass-sheen';

	let { children } = $props();

	// Prototype: align every frosted-glass sheen to one page-anchored light source
	// (per-element animation-delay from position). Re-runs when the modal opens so its
	// glass panels/buttons join the same beam; page-anchored, so scroll needs no work.
	$effect(() => {
		void contactDialog.open; // re-sync when the modal mounts its glass elements
		return syncGlassSheen();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-dvh flex-col">
	<Header />
	<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10">
		{@render children()}
	</main>
	<Footer />
</div>

<!-- Fixed void-coloured gradient below the header: content dissolves into the
     void before it slides under/around the glass nav. See .header-scrim. -->
<div class="header-scrim" aria-hidden="true"></div>

<BackToTop />

<!-- Global contact modal (issue #11) — rendered once; opened from the hero/CTA
     buttons and the footer link via the shared `contactDialog` rune. -->
<ContactDialog />
