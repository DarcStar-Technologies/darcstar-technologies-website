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
	import { glassDiagnostics, STATIC_CLIP_PATH } from '$lib/glass-diagnostics';
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

	// TEMPORARY (DAR-170) — remove with the ticket, along with $lib/glass-diagnostics and the
	// diagnostic block at the foot of layout.css. `?glassdiag=nosheen|noblur` isolates the two
	// candidate causes of the mobile scroll ghosting so one deploy can answer the whole matrix on a
	// real device. Derived from the URL, so it survives client-side navigation between pages (the
	// artifact appears on all of them) and is already correct in the SSR'd HTML — no unfrosted flash
	// on the `noblur` arm. Inert without the parameter: `attr` is then undefined and Svelte omits
	// the attribute entirely.
	const glassDiag = $derived(glassDiagnostics(page.url.searchParams));

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

<!-- `data-glass-diag` is DAR-170's diagnostic hook (absent in normal operation) and carries the
     `noblur` arm to layout.css. It sits on this wrapper rather than <html>, which covers every
     scroll-relevant glass surface — the nav, the cards, the buttons, the footer icons. The portalled
     dialogs mount outside it and so keep their blur; they are not part of a scroll artifact. -->
<div class="flex min-h-dvh flex-col" data-glass-diag={glassDiag.attr}>
	<Header />
	<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10">
		{@render children()}
	</main>
	<Footer {socialLinks} />
</div>

<!-- Fixed void-coloured gradient below the header: content dissolves into the
     void before it slides under/around the glass nav. See .header-scrim. -->
<div class="header-scrim" aria-hidden="true"></div>

<!-- One light plane clipped to the frosted-glass windows (see .sheen-plane).
     The `{#if}` is DAR-170's `nosheen` arm and is the reason this is a render gate rather than a CSS
     one: not rendering the node means `createSheenSync` never attaches, so the arm removes the scroll
     listener and the per-frame clip-path write as well as the beam. Hiding it in CSS would leave the
     prime suspect running. `sheen` simply stays undefined — every call site already optional-chains. -->
{#if !glassDiag.noSheen}
	<div
		class="sheen-plane"
		aria-hidden="true"
		{@attach (node) => {
			// DAR-170's `noclip` arm, kept past the fix as the reference for "nothing observes scroll
			// at all": the plane and both beams mount, the sync never attaches, and each layer's clip
			// is pinned to a static path (the inline `style:clip-path` below) so the beams are visible
			// without JS ever writing geometry. The fix itself already removes the per-frame clip
			// write, so this arm now differs from the default only in the two transform writes.
			if (glassDiag.noClip) return;
			sheen = createSheenSync(node);
			return () => {
				sheen?.destroy();
				sheen = undefined;
			};
		}}
	>
		<!-- Two clip surfaces, one per anchoring regime (DAR-170; see glass-sheen.ts). The viewport
		     layer holds sticky/fixed glass — the nav and the dialog — whose viewport rects don't move
		     with scroll, so it needs no transform. The page layer's clip is in PAGE coordinates and the
		     layer is translated by -scroll, with the anchor inside translated back by +scroll so the
		     beam stays screen-anchored. Net effect: scroll writes transforms, never a clip path. -->
		<div
			class="sheen-plane__layer"
			style:clip-path={glassDiag.noClip ? STATIC_CLIP_PATH : undefined}
			data-sheen-layer="viewport"
		>
			<div class="sheen-plane__beam"></div>
		</div>
		<div
			class="sheen-plane__layer"
			style:clip-path={glassDiag.noClip ? STATIC_CLIP_PATH : undefined}
			data-sheen-layer="page"
		>
			<div class="sheen-plane__anchor" data-sheen-anchor>
				<div class="sheen-plane__beam"></div>
			</div>
		</div>
	</div>
{/if}

<BackToTop />

<!-- Global contact modal (issue #11) — rendered once; opened from the hero/CTA
     buttons and the footer link via the shared `contactDialog` rune. -->
<ContactDialog />

<!-- Global login modal (issue #69) — rendered once; opened from the navbar "Sign in"
     link via the shared `loginDialog` rune (the link's href is the no-JS fallback). -->
<LoginDialog />
