<script lang="ts">
	// /research — the papers/preprints index (Sanity `paper`). The title links to /research/[slug];
	// external links (arXiv/DOI/code/publisher) sit beside it (so the card can't be a single anchor).
	// Chrome copy via Paraglide; paper fields are CMS data rendered as `{expr}`.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import PaperStatus from '$lib/components/PaperStatus.svelte';
	import PaperLinks from '$lib/components/PaperLinks.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<Seo title={m.research_page_title()} description={m.research_page_description()} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.research_eyebrow()}
		heading={m.research_heading()}
		lead={m.research_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl">
		{#if data.papers.length === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.research_empty()}</p>
		{:else}
			<ul class="space-y-6">
				{#each data.papers as paper (paper._id)}
					<li class="glass-card p-6 sm:p-7">
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
						<h2 class="mt-3 text-xl font-medium tracking-tight text-white">
							<a
								href={localizeHref(`/research/${paper.slug}`)}
								class="transition-colors hover:text-primary-400">{paper.title}</a
							>
						</h2>
						{#if paper.authors && paper.authors.length > 0}
							<p class="mt-1 text-xs text-muted">
								{m.content_by()}
								{paper.authors.map((a) => a.name).join(', ')}
							</p>
						{/if}
						{#if paper.abstract}
							<p class="mt-3 line-clamp-3 text-sm leading-relaxed text-body">{paper.abstract}</p>
						{/if}
						<div class="mt-4">
							<PaperLinks
								arxivId={paper.arxivId}
								doi={paper.doi}
								codeUrl={paper.codeUrl}
								url={paper.url}
							/>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
