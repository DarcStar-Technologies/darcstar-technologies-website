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
	import { page } from '$app/state';
	import { jsonLdScript, organizationJsonLd } from '$lib/jsonld';
	import { FALLBACK_SOCIAL_LINKS } from '$lib/social-links';

	let { children } = $props();

	// CMS-driven social profiles from the root `+layout.server.ts` (DAR-73). One resolved list feeds
	// BOTH the footer's button row and the Organization node's `sameAs`, so the rendered links and
	// the machine-readable identities can't disagree. The server already floors this; the `??` covers
	// the one case where layout data is absent entirely — an error page rendered before the load ran
	// — and must be the FLOOR, not `[]`, or that page would ship an empty social row.
	const socialLinks = $derived(page.data.socialLinks ?? FALLBACK_SOCIAL_LINKS);

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

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- Site-wide Organization JSON-LD (DAR-48). Lives HERE, not in <Seo>, deliberately: every
	     page carries the org node once, and pages' own nodes reference it by @id (…/#organization).
	     This does not breach the "one <Seo> per page, never in the layout" rule — that rule exists
	     because duplicated OG tags corrupt scrapes; a second, differently-typed head entry doesn't.
	     Inert data block (never executed), safely serialized — see $lib/jsonld.ts. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLdScript(
		organizationJsonLd(page.url.origin, { sameAs: socialLinks.map((link) => link.url) })
	)}
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<Header />
	<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10">
		{@render children()}
	</main>
	<Footer {socialLinks} />
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
