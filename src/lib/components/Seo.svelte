<script lang="ts">
	// Per-page document head — title, description, canonical, and the Open Graph +
	// Twitter card tags a link needs to render a rich preview when shared to
	// investors via email/Slack/LinkedIn/X (issue #9). SSR emits all of this into
	// the initial HTML, so scrapers (which don't run JS) see it.
	//
	// Render exactly ONE <Seo> per page (not in the layout — SvelteKit merges every
	// component's <svelte:head>, so a layout copy plus a page copy would duplicate
	// the OG tags). Props override the site-wide defaults below.
	import { page } from '$app/state';
	import { getLocale, locales } from '$lib/paraglide/runtime';
	// Fingerprint-imported: a regenerated card (node scripts/gen-og.mjs) gets a new
	// hashed URL, so scrapers re-fetch instead of caching stale. Source: scripts/gen-og.mjs.
	import ogImage from '$lib/assets/og-image.png';

	const SITE = 'DarcStar Technologies';
	const DEFAULT_TITLE = 'DarcStar Technologies — Provably-safe autonomous control';
	const DEFAULT_DESCRIPTION =
		'GIDE is a real-time intelligent control engine with machine-checked safety guarantees — proven across robotics, markets, and software that improves itself.';
	// BCP-47 → OG's underscore locale form. Mirrors project.inlang locales (en, es).
	const OG_LOCALE: Record<string, string> = { en: 'en_US', es: 'es_ES' };

	interface Props {
		/** Full <title>. Defaults to the brand + tagline. */
		title?: string;
		/** Meta description — aim ≤160 chars. */
		description?: string;
		/** Canonical/OG path, root-relative (defaults to the current pathname). */
		path?: string;
		/** og:type — 'website' for landing pages, 'article' for posts. */
		type?: string;
		/** Root-relative image path (fingerprinted OG card by default). */
		image?: string;
		imageAlt?: string;
	}

	let {
		title = DEFAULT_TITLE,
		description = DEFAULT_DESCRIPTION,
		path,
		type = 'website',
		image = ogImage,
		imageAlt = 'DarcStar Technologies — GIDE, provably-safe autonomous control'
	}: Props = $props();

	// Absolutize against the serving origin — on production this is darcstar.tech,
	// which is what social scrapers hit and what OG/canonical URLs must be.
	const origin = $derived(page.url.origin);
	const canonical = $derived(origin + (path ?? page.url.pathname));
	const imageUrl = $derived(origin + image);
	const locale = $derived(getLocale());
	const ogLocale = $derived(OG_LOCALE[locale] ?? 'en_US');
	const altLocales = $derived(locales.filter((l) => l !== locale));
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	<meta name="theme-color" content="#04050a" />

	<!-- Open Graph -->
	<meta property="og:type" content={type} />
	<meta property="og:site_name" content={SITE} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={imageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={imageAlt} />
	<meta property="og:locale" content={ogLocale} />
	{#each altLocales as l (l)}
		<meta property="og:locale:alternate" content={OG_LOCALE[l] ?? l} />
	{/each}

	<!-- Twitter / X -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={imageUrl} />
	<meta name="twitter:image:alt" content={imageAlt} />
</svelte:head>
