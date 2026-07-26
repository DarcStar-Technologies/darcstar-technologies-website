<script lang="ts">
	// /research/[slug] — a single paper: helix hero with the title, then status/venue/date/authors/
	// topics/categories, the external links (incl. a hosted PDF), the abstract, and the DarcStar commentary
	// (Portable Text — PortableBody resolves its inline images the same way post bodies do).
	// `data.paper` is non-null (load 404s a missing slug). Third-party papers (DAR-52: any entry not
	// explicitly `darcstarAuthored`) carry an origin chip + an explicit not-ours disclaimer.
	// The head comes from the paper's `seo` field via contentSeo() → abstract → site defaults.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import PaperStatus, { pillClass } from '$lib/components/PaperStatus.svelte';
	import PaperOrigin from '$lib/components/PaperOrigin.svelte';
	import PaperExternalDisclaimer from '$lib/components/PaperExternalDisclaimer.svelte';
	import PaperTopics from '$lib/components/PaperTopics.svelte';
	import { researchTopicHref } from '$lib/research-filters';
	import PaperLinks from '$lib/components/PaperLinks.svelte';
	import PortableBody from '$lib/components/portable/PortableBody.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { contentSeo } from '$lib/sanity/content-seo';
	import { breadcrumbJsonLd, paperCanonicalUrl, scholarlyArticleJsonLd } from '$lib/jsonld';
	import { page } from '$app/state';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const paper = $derived(data.paper);

	// Third-party papers lead their fallback description with the not-ours statement — the social
	// preview (site-suffixed title + default DarcStar OG card) otherwise carries no origin signal.
	const fallbackDescription = $derived(
		paper.abstract && !paper.darcstarAuthored
			? `${m.research_external_disclaimer()} ${paper.abstract}`
			: (paper.abstract ?? undefined)
	);
	// A third-party page reproduces the source's abstract verbatim, so it points search engines at
	// the original rather than competing for that text (DAR-70). The rule and its fail-safe polarity
	// live in paperCanonicalUrl, not here — inline, nothing could test them. An editor still
	// overrides per-document via the Studio's `seo.canonicalUrl`; contentSeo prefers that.
	// Every <Seo> prop the paper's SEO tab drives — including its "hide from search engines" toggle
	// (DAR-71) — comes from this one mapper, spread below. Papers have no cover image, so an unset
	// seo.ogImage falls straight through to the brand OG card.
	const seo = $derived(
		contentSeo(paper.seo, {
			title: m.content_doc_title({ title: paper.title }),
			description: fallbackDescription,
			imageAlt: paper.title,
			canonical: paperCanonicalUrl(paper)
		})
	);

	// ScholarlyArticle + breadcrumb JSON-LD (DAR-48) — external identities (publisher page,
	// DOI, arXiv) ride along as sameAs; our detail page stays the mainEntityOfPage.
	const pageUrl = $derived(page.url.origin + page.url.pathname);
	const jsonLd = $derived([
		scholarlyArticleJsonLd(paper, { url: pageUrl }),
		breadcrumbJsonLd([
			{ name: m.footer_nav_home(), url: page.url.origin + localizeHref('/') },
			{ name: m.nav_research(), url: page.url.origin + localizeHref('/research') },
			{ name: paper.title, url: pageUrl }
		])
	]);
</script>

<Seo {...seo} type="article" {jsonLd} />

<CosmicBackdrop />

<article class="space-y-12">
	<PageHero eyebrow={m.research_eyebrow()} heading={paper.title} />

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<div class="flex flex-col gap-4">
			<a
				href={localizeHref('/research')}
				class="text-sm font-medium text-primary-500 transition-colors hover:text-primary-400"
				>{m.research_back()}</a
			>
			<div class="flex flex-wrap items-center gap-3">
				<PaperStatus status={paper.status} />
				<PaperOrigin darcstarAuthored={paper.darcstarAuthored} />
				{#if paper.venue || paper.publishedDate}
					<span class="text-xs text-muted">
						{#if paper.venue}{paper.venue}{/if}{#if paper.venue && paper.publishedDate}
							·
						{/if}{#if paper.publishedDate}{formatDate(paper.publishedDate, getLocale())}{/if}
					</span>
				{/if}
			</div>
			<PaperExternalDisclaimer darcstarAuthored={paper.darcstarAuthored} />
			{#if paper.authors && paper.authors.length > 0}
				<p class="text-sm text-body">
					{m.content_by()}
					{paper.authors.map((a) => a.name).join(', ')}
				</p>
			{/if}
			<PaperTopics topics={paper.topics} topicHref={researchTopicHref} />
			{#if paper.categories && paper.categories.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each paper.categories as cat (cat._id)}
						<span class="{pillClass} border-hairline text-body">{cat.title}</span>
					{/each}
				</div>
			{/if}
		</div>

		<PaperLinks
			arxivId={paper.arxivId}
			doi={paper.doi}
			pdfUrl={paper.pdfUrl}
			codeUrl={paper.codeUrl}
			url={paper.url}
		/>

		{#if paper.abstract}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">
					{m.research_abstract_heading()}
				</h2>
				<p class="mt-4 text-sm leading-relaxed whitespace-pre-line text-body">{paper.abstract}</p>
			</section>
		{/if}

		{#if paper.commentary && paper.commentary.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">
					{m.research_commentary_heading()}
				</h2>
				<!-- The note's "our take on this work" framing fits annotated THIRD-PARTY papers; a
				     first-party paper with commentary gets the section without the external framing. -->
				{#if !paper.darcstarAuthored}
					<p class="mt-1 text-xs text-muted">{m.research_commentary_note()}</p>
				{/if}
				<div class="mt-4">
					<PortableBody value={paper.commentary} />
				</div>
			</section>
		{/if}
	</div>
</article>
