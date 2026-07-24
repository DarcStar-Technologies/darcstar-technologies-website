<script lang="ts">
	// /research — the papers/preprints index (Sanity `paper`). The title links to /research/[slug];
	// external links (arXiv/DOI/code/publisher) sit beside it (so the card can't be a single anchor).
	// Chrome copy via Paraglide; paper fields are CMS data rendered as `{expr}`.
	//
	// Split by origin (DAR-52): first-party DarcStar work and third-party "foundational reading"
	// render as separate sections, and every external card carries origin chips (PaperOrigin) plus
	// an explicit not-ours disclaimer — third-party research must never read as DarcStar's.
	// `!darcstarAuthored` (not `=== false`) so an unset/null flag stays external, the fail-safe
	// direction. Empty groups skip their section entirely.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import PaperStatus from '$lib/components/PaperStatus.svelte';
	import PaperOrigin from '$lib/components/PaperOrigin.svelte';
	import PaperLinks from '$lib/components/PaperLinks.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const darcstarPapers = $derived(data.papers.filter((p) => p.darcstarAuthored));
	const externalPapers = $derived(data.papers.filter((p) => !p.darcstarAuthored));
</script>

<Seo title={m.research_page_title()} description={m.research_page_description()} />

<CosmicBackdrop />

{#snippet paperCard(paper: PageServerData['papers'][number])}
	<li class="glass-card p-6 sm:p-7">
		<div class="flex flex-wrap items-center gap-3">
			<PaperStatus status={paper.status} />
			<PaperOrigin darcstarAuthored={paper.darcstarAuthored} hasCommentary={paper.hasCommentary} />
			{#if paper.venue || paper.publishedDate}
				<span class="text-xs text-muted">
					{#if paper.venue}{paper.venue}{/if}{#if paper.venue && paper.publishedDate}
						·
					{/if}{#if paper.publishedDate}{formatDate(paper.publishedDate, getLocale())}{/if}
				</span>
			{/if}
		</div>
		<h3 class="mt-3 text-xl font-medium tracking-tight text-white">
			<a
				href={localizeHref(`/research/${paper.slug}`)}
				class="transition-colors hover:text-primary-400">{paper.title}</a
			>
		</h3>
		{#if paper.authors && paper.authors.length > 0}
			<p class="mt-1 text-xs text-muted">
				{m.content_by()}
				{paper.authors.map((a) => a.name).join(', ')}
			</p>
		{/if}
		{#if !paper.darcstarAuthored}
			<p class="mt-2 text-xs text-muted">{m.research_external_disclaimer()}</p>
		{/if}
		{#if paper.abstract}
			<p class="mt-3 line-clamp-3 text-sm leading-relaxed text-body">{paper.abstract}</p>
		{/if}
		<div class="mt-4">
			<PaperLinks arxivId={paper.arxivId} doi={paper.doi} codeUrl={paper.codeUrl} url={paper.url} />
		</div>
	</li>
{/snippet}

<div class="space-y-14">
	<PageHero
		eyebrow={m.research_eyebrow()}
		heading={m.research_heading()}
		emphasis={m.research_heading_emphasis()}
		lead={m.research_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl">
		{#if data.papers.length === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.research_empty()}</p>
		{:else}
			<div class="space-y-12">
				{#if darcstarPapers.length > 0}
					<section>
						<h2 class="text-lg font-medium tracking-tight text-white">
							{m.research_section_darcstar_heading()}
						</h2>
						<p class="mt-1 text-sm text-muted">{m.research_section_darcstar_note()}</p>
						<ul class="mt-6 space-y-6">
							{#each darcstarPapers as paper (paper._id)}
								{@render paperCard(paper)}
							{/each}
						</ul>
					</section>
				{/if}

				{#if externalPapers.length > 0}
					<section>
						<h2 class="text-lg font-medium tracking-tight text-white">
							{m.research_section_external_heading()}
						</h2>
						<p class="mt-1 text-sm text-muted">{m.research_section_external_note()}</p>
						<ul class="mt-6 space-y-6">
							{#each externalPapers as paper (paper._id)}
								{@render paperCard(paper)}
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>
