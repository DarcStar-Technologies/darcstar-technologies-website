<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon-16.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import ContactDialog from '$lib/components/ContactDialog.svelte';
	import LoginDialog from '$lib/components/LoginDialog.svelte';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { loginDialog } from '$lib/login-dialog.svelte';
	import { createSheenSync } from '$lib/glass-sheen';
	import { afterNavigate } from '$app/navigation';

	let { children } = $props();

	// One coherent light source across all frosted glass (see `.sheen-plane`). The sync
	// keeps the plane's clip-path tracking the glass windows; re-clip when a modal (contact or
	// login) opens/closes so its panel joins the beam (and the page panels drop out behind the
	// scrim while it's up).
	let sheen: ReturnType<typeof createSheenSync> | undefined;
	$effect(() => {
		// Read both up front (not a short-circuiting `||`) so the effect tracks BOTH dialogs and
		// re-clips whenever either one toggles.
		const contactOpen = contactDialog.open;
		const loginOpen = loginDialog.open;
		sheen?.refresh(contactOpen || loginOpen);
	});

	// The sheen plane persists across client-side navigation (it's in this layout), but each
	// route has its own glass panels — so re-clip after every navigation, else the beam stays
	// pinned to the previous page's panels (a ghost that only realigns on scroll/refresh).
	afterNavigate(() => sheen?.refresh(contactDialog.open || loginDialog.open));
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

<!-- Global login modal (issue #69) — rendered once; opened from the navbar "Sign in"
     link via the shared `loginDialog` rune (the link's href is the no-JS fallback). -->
<LoginDialog />
