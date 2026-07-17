<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon-16.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import ContactDialog from '$lib/components/ContactDialog.svelte';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { createSheenSync } from '$lib/glass-sheen';

	let { children } = $props();

	// One coherent light source across all frosted glass (see `.sheen-plane`). The sync
	// keeps the plane's clip-path tracking the glass windows; re-clip when the modal
	// opens/closes so its panel joins the beam (and the page panels drop out behind the
	// scrim while it's up).
	let sheen: ReturnType<typeof createSheenSync> | undefined;
	$effect(() => {
		sheen?.refresh(contactDialog.open);
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

<!-- One light plane clipped to the frosted-glass windows (see .sheen-plane). -->
<div
	class="sheen-plane"
	aria-hidden="true"
	{@attach (node) => {
		sheen = createSheenSync(node);
		return () => {
			sheen?.destroy();
			sheen = undefined;
		};
	}}
>
	<div class="sheen-plane__beam"></div>
</div>

<BackToTop />

<!-- Global contact modal (issue #11) — rendered once; opened from the hero/CTA
     buttons and the footer link via the shared `contactDialog` rune. -->
<ContactDialog />
