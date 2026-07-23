<script lang="ts">
	// /research/[slug] — a single paper: helix hero with the title, then status/venue/date/authors/
	// categories, the external links (incl. a hosted PDF), and the abstract. `data.paper` is non-null
	// (load 404s a missing slug). SEO derives from the paper's `seo` field → abstract → site defaults.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import PaperStatus from '$lib/components/PaperStatus.svelte';
	import PaperLinks from '$lib/components/PaperLinks.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { ogImageUrl } from '$lib/sanity/image';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const paper = $derived(data.paper);

	const seoTitle = $derived(paper.seo?.metaTitle ?? m.content_doc_title({ title: paper.title }));
	const seoDescription = $derived(paper.seo?.metaDescription ?? paper.abstract ?? undefined);
	const seoImage = $derived(ogImageUrl(paper.seo?.ogImage));
</script>

<Seo
	title={seoTitle}
	description={seoDescription}
	type="article"
	image={seoImage}
	imageAlt={seoImage ? paper.title : undefined}
/>

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
				{#if paper.venue || paper.publishedDate}
					<span class="text-xs text-muted">
						{#if paper.venue}{paper.venue}{/if}{#if paper.venue && paper.publishedDate}
							·
						{/if}{#if paper.publishedDate}{formatDate(paper.publishedDate, getLocale())}{/if}
					</span>
				{/if}
			</div>
			{#if paper.authors && paper.authors.length > 0}
				<p class="text-sm text-body">
					{m.content_by()}
					{paper.authors.map((a) => a.name).join(', ')}
				</p>
			{/if}
			{#if paper.categories && paper.categories.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each paper.categories as cat (cat._id)}
						<span class="rounded-full border border-hairline px-3 py-1 text-xs text-body"
							>{cat.title}</span
						>
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
	</div>
</article>
