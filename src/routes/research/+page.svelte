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
	//
	// Filtering/sorting (?topic=&author=&origin=&sort=): URL params are the single source of
	// state — shareable, SSR-rendered, and no-JS friendly. Without JS the bar is a native GET
	// form (Apply submits, empty params are tolerated); with JS every change goes through
	// `goto` for an in-place update with clean URLs. All derivation happens here over the ONE
	// papers fetch (semantics in $lib/research-filters, unit-tested); the server load never
	// reads the URL, so query-only navigations don't re-hit Sanity.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import PaperStatus from '$lib/components/PaperStatus.svelte';
	import PaperOrigin from '$lib/components/PaperOrigin.svelte';
	import PaperExternalDisclaimer from '$lib/components/PaperExternalDisclaimer.svelte';
	import PaperTopics from '$lib/components/PaperTopics.svelte';
	import PaperLinks from '$lib/components/PaperLinks.svelte';
	import { inlineLinkClass } from '$lib/components/FormPrivacyNotice.svelte';
	import { fieldClass } from '$lib/components/ContactFields.svelte';
	import {
		buildFilterQuery,
		filterPapers,
		hasActiveFilters,
		paperFacets,
		parseResearchFilters,
		sortPapers,
		type FacetOption
	} from '$lib/research-filters';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const filters = $derived(parseResearchFilters(page.url.searchParams));
	const facets = $derived(paperFacets(data.papers));
	const filtered = $derived(filterPapers(data.papers, filters));
	const darcstarPapers = $derived(
		sortPapers(
			filtered.filter((p) => p.darcstarAuthored),
			filters.sort,
			getLocale()
		)
	);
	const externalPapers = $derived(
		sortPapers(
			filtered.filter((p) => !p.darcstarAuthored),
			filters.sort,
			getLocale()
		)
	);
	const filtersActive = $derived(hasActiveFilters(filters));

	const originOptions = $derived<FacetOption[]>([
		{ value: 'darcstar', label: m.research_filter_origin_darcstar() },
		{ value: 'external', label: m.research_filter_origin_external() }
	]);
	const sortOptions = $derived<FacetOption[]>([{ value: 'title', label: m.research_sort_title() }]);

	// JS path: rebuild the query from the form and navigate in place (buildFilterQuery keeps
	// the URL clean of empty params).
	function applyFilters(form: HTMLFormElement) {
		const query = buildFilterQuery(new FormData(form));
		goto(query ? `${page.url.pathname}?${query}` : page.url.pathname, {
			noScroll: true,
			keepFocus: true
		});
	}

	const topicFilterHref = (slug: string) =>
		localizeHref(`/research?topic=${encodeURIComponent(slug)}`);
</script>

<Seo title={m.research_page_title()} description={m.research_page_description()} />

<CosmicBackdrop />

<!-- Title leads (it's the card's one internal link — the shared inlineLinkClass affordance so it
     unmistakably reads as one), then the status/origin/venue meta rail beneath it. -->
{#snippet paperCard(paper: PageServerData['papers'][number])}
	<li class="glass-card p-6 sm:p-7">
		<h3 class="text-xl font-medium tracking-tight">
			<a href={localizeHref(`/research/${paper.slug}`)} class={inlineLinkClass}>{paper.title}</a>
		</h3>
		<div class="mt-3 flex flex-wrap items-center gap-3">
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
		{#if paper.authors && paper.authors.length > 0}
			<p class="mt-2 text-xs text-muted">
				{m.content_by()}
				{paper.authors.map((a) => a.name).join(', ')}
			</p>
		{/if}
		<PaperExternalDisclaimer darcstarAuthored={paper.darcstarAuthored} compact />
		{#if paper.abstract}
			<p class="mt-3 line-clamp-3 text-sm leading-relaxed text-body">{paper.abstract}</p>
		{/if}
		<PaperTopics topics={paper.topics} class="mt-3" topicHref={topicFilterHref} />
		<div class="mt-4">
			<PaperLinks arxivId={paper.arxivId} doi={paper.doi} codeUrl={paper.codeUrl} url={paper.url} />
		</div>
	</li>
{/snippet}

<!-- One origin group — heading, note, and its cards. The h2 outsizes the text-xl card titles at
     EVERY width (base text-2xl, no breakpoint) so the group heading always dominates its children. -->
{#snippet paperSection(heading: string, note: string, papers: PageServerData['papers'])}
	<section>
		<h2 class="text-2xl font-medium tracking-tight text-white">{heading}</h2>
		<p class="mt-1 text-sm text-muted">{note}</p>
		<ul class="mt-6 space-y-6">
			{#each papers as paper (paper._id)}
				{@render paperCard(paper)}
			{/each}
		</ul>
	</section>
{/snippet}

<!-- One labeled facet select. `current === null` selects the empty "All …"/default option, so
     SSR renders the URL's state without JS. -->
{#snippet filterSelect(
	name: string,
	label: string,
	emptyLabel: string,
	options: FacetOption[],
	current: string | null
)}
	<label class="block">
		<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">{label}</span>
		<select {name} class={fieldClass}>
			<option value="" selected={current === null}>{emptyLabel}</option>
			{#each options as opt (opt.value)}
				<option value={opt.value} selected={current === opt.value}>{opt.label}</option>
			{/each}
		</select>
	</label>
{/snippet}

<div class="space-y-14">
	<PageHero
		eyebrow={m.research_eyebrow()}
		heading={m.research_heading()}
		emphasis={m.research_heading_emphasis()}
		lead={m.research_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<form
			method="GET"
			aria-label={m.research_filter_label()}
			class="glass-card grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:p-5"
			onchange={(e) => applyFilters(e.currentTarget)}
			onsubmit={(e) => {
				e.preventDefault();
				applyFilters(e.currentTarget);
			}}
		>
			{@render filterSelect(
				'topic',
				m.research_filter_topic_label(),
				m.research_filter_all_topics(),
				facets.topics,
				filters.topic
			)}
			{@render filterSelect(
				'author',
				m.research_filter_author_label(),
				m.research_filter_all_authors(),
				facets.authors,
				filters.author
			)}
			{@render filterSelect(
				'origin',
				m.research_filter_origin_label(),
				m.research_filter_all_origins(),
				originOptions,
				filters.origin
			)}
			{@render filterSelect(
				'sort',
				m.research_filter_sort_label(),
				m.research_sort_newest(),
				sortOptions,
				filters.sort === 'date' ? null : filters.sort
			)}
			<div class="col-span-2 flex items-center gap-3 sm:col-span-1">
				<button
					type="submit"
					class="glass-btn rounded-lg px-4 py-2.5 text-sm font-medium text-white"
				>
					{m.research_filter_apply()}
				</button>
				{#if filtersActive}
					<a
						href={localizeHref('/research')}
						class="text-xs text-muted transition-colors hover:text-white"
					>
						{m.research_filter_clear()}
					</a>
				{/if}
			</div>
		</form>

		{#if data.papers.length === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.research_empty()}</p>
		{:else if filtered.length === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">
				{m.research_filter_no_matches()}
				<a href={localizeHref('/research')} class={inlineLinkClass}>{m.research_filter_clear()}</a>
			</p>
		{:else}
			<div class="space-y-12">
				{#if darcstarPapers.length > 0}
					{@render paperSection(
						m.research_section_darcstar_heading(),
						m.research_section_darcstar_note(),
						darcstarPapers
					)}
				{/if}

				{#if externalPapers.length > 0}
					{@render paperSection(
						m.research_section_external_heading(),
						m.research_section_external_note(),
						externalPapers
					)}
				{/if}
			</div>
		{/if}
	</div>
</div>
