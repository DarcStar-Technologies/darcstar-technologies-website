<script lang="ts">
	// /research — the papers/preprints index (Sanity `paper`). The title links to /research/[slug];
	// external links (arXiv/DOI/code/publisher) sit beside it (so the card can't be a single anchor).
	// Chrome copy via Paraglide; paper fields are CMS data rendered as `{expr}`.
	//
	// Split by origin (DAR-52): first-party DarcStar work and third-party "foundational reading"
	// render as separate sections, and every external card carries origin chips (PaperOrigin) plus
	// an explicit not-ours disclaimer — third-party research must never read as DarcStar's. The
	// fail-safe polarity (an unset/null flag stays external) is `isDarcstarAuthored`, which the
	// section partition reads; the origin FILTER now spells the same rule in GROQ
	// (`darcstarAuthored != true`), so it lives in two languages and is pinned in both specs. The
	// query sorts origin-major, which is what stops a page straddling the split. Empty groups skip
	// their section.
	//
	// Filtering/sorting/paging (?topic=&author=&origin=&sort=&page=): URL params are the single
	// source of state — shareable, SSR-rendered, and no-JS friendly. Without JS the bar is a native
	// GET form (Apply submits, empty params are tolerated); with JS every change goes through `goto`
	// for an in-place update with clean URLs.
	//
	// DAR-94 moved the actual filtering, sorting and facet derivation into GROQ — the index is
	// paginated, and none of the three can be derived from a single page. What this file still
	// derives is the origin split of the rows it was given, which is legitimately per-page.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import PaperStatus from '$lib/components/PaperStatus.svelte';
	import PaperOrigin from '$lib/components/PaperOrigin.svelte';
	import PaperExternalDisclaimer from '$lib/components/PaperExternalDisclaimer.svelte';
	import PaperTopics from '$lib/components/PaperTopics.svelte';
	import PaperLinks from '$lib/components/PaperLinks.svelte';
	import TopicGuide from '$lib/components/TopicGuide.svelte';
	import AuthorSuggestions from '$lib/components/AuthorSuggestions.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import { inlineLinkClass, mutedLinkClass } from '$lib/styles';
	import { fieldClass } from '$lib/styles';
	import {
		authorSearchTerm,
		buildFilterQuery,
		FILTER_PARAM,
		hasActiveFilters,
		partitionByOrigin,
		parseResearchFilters,
		researchTopicHref,
		topicOptions,
		type AuthorOption,
		type FacetOption
	} from '$lib/research-filters';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	// The filters still come from the URL rather than from `data`, so the controls re-render the
	// instant a navigation starts instead of waiting on the server round trip.
	//
	// `data.topics` is the taxonomy's OWN in-use vocabulary, not the topics of the papers on this
	// page — that is what lets the Topic select and the topic guide keep describing the whole index
	// once the fetch is a single page (DAR-56's guide would otherwise explain 20 papers' worth).
	const filters = $derived(parseResearchFilters(page.url.searchParams));
	const topicSelectOptions = $derived(topicOptions(data.topics));
	// A title sort merges the origin sections into ONE alphabetical list — two separately-sorted
	// sections would read as broken. Safe: every card carries its own origin chip + disclaimer
	// (DAR-52), so the section framing is redundant for correctness. For the date sorts the query
	// orders origin-major, so a page's sections are contiguous and in the right order.
	const mergeSections = $derived(filters.sort === 'title');
	const sections = $derived(partitionByOrigin(data.papers));
	const filtersActive = $derived(hasActiveFilters(filters));

	// The author control is a text input, not a select: the author vocabulary grows with the corpus
	// and never plateaus (123 people for 18 papers), so shipping it as options would undo the point
	// of paginating. `data.teamAuthors` seeds the <datalist> — bounded, and a native datalist offers
	// it with JS off — and typing 3+ characters replaces it with server matches, team first.
	//
	// `null` means "show the seed", which is not the same as an empty match list: clearing the box
	// must restore the team names rather than leave the visitor with an empty dropdown.
	let authorMatches = $state<AuthorOption[] | null>(null);
	const authorOptions = $derived(authorMatches ?? data.teamAuthors);

	// Guards against a slow response for "da" landing after a fast one for "dao" and repopulating
	// the list with the wrong matches — the classic type-ahead race. Only the newest request wins.
	let authorRequest = 0;
	let authorTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(authorTimer));

	function onAuthorInput(event: Event & { currentTarget: HTMLInputElement }) {
		const term = authorSearchTerm(event.currentTarget.value);
		clearTimeout(authorTimer);
		if (!term) {
			// Below the floor there is nothing to ask for — the endpoint would refuse anyway, since
			// an unbounded `match` returns the entire vocabulary.
			authorRequest++;
			authorMatches = null;
			return;
		}
		authorTimer = setTimeout(() => void loadAuthorMatches(term), 200);
	}

	async function loadAuthorMatches(term: string) {
		const request = ++authorRequest;
		try {
			const res = await fetch(`/research/authors.json?q=${encodeURIComponent(term)}`);
			if (!res.ok) return;
			const body: { authors?: AuthorOption[] } = await res.json();
			if (request === authorRequest) authorMatches = body.authors ?? [];
		} catch {
			// Keep whatever the list already offers. The filter itself is server-side, so a failed
			// lookup costs suggestions, never the ability to filter — the visitor can still submit.
		}
	}

	const originOptions = $derived<FacetOption[]>([
		{ value: 'darcstar', label: m.research_filter_origin_darcstar() },
		{ value: 'external', label: m.research_filter_origin_external() }
	]);
	const sortOptions = $derived<FacetOption[]>([
		{ value: 'date-asc', label: m.research_sort_oldest() },
		{ value: 'title', label: m.research_sort_title() }
	]);

	// JS path: rebuild the query from the form and navigate in place (buildFilterQuery keeps
	// the URL clean of empty params). Debounced: a collapsed <select> fires `change` on every
	// arrow keypress in Firefox/Chrome-on-Linux, so navigating per keystroke would storm the
	// history — 250ms collapses a run of keypresses into one goto. Identical-URL calls bail so
	// change-then-Apply doesn't navigate twice. Apply (submit) flushes immediately.
	//
	// This is also what returns a visitor to page 1 when they narrow a filter: the target is rebuilt
	// from the form's own fields, and `page` is not one of them (nor a member of FILTER_PARAM), so
	// it cannot survive. The no-JS path gets the same reset for free — a native GET submit replaces
	// the whole query string.
	let applyTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(applyTimer));
	function applyFilters(form: HTMLFormElement, immediate = false) {
		const query = buildFilterQuery(new FormData(form));
		const target = query ? `${page.url.pathname}?${query}` : page.url.pathname;
		clearTimeout(applyTimer);
		if (target === page.url.pathname + page.url.search) return;
		const navigate = () => goto(target, { noScroll: true, keepFocus: true });
		if (immediate) navigate();
		else applyTimer = setTimeout(navigate, 250);
	}
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
		<PaperTopics topics={paper.topics} class="mt-3" topicHref={researchTopicHref} />
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

<!-- One labeled facet select, driven entirely by `value` on the <select>: Svelte marks the
     matching option during SSR (no-JS state) AND sets the IDL value client-side — which
     per-option `selected` attrs can't do once the user has touched the control (browsers
     ignore attribute changes on a dirtied select, so Clear/Back/tag-link navigations would
     desync the display). An unknown URL value (renamed slug, hand-edited URL) renders as a
     raw synthetic option rather than masquerading as "All". -->
{#snippet filterSelect(
	name: string,
	label: string,
	emptyLabel: string,
	options: FacetOption[],
	current: string | null
)}
	<label class="block">
		<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">{label}</span>
		<select {name} value={current ?? ''} class={fieldClass}>
			<option value="">{emptyLabel}</option>
			{#if current !== null && !options.some((o) => o.value === current)}
				<option value={current}>{current}</option>
			{/if}
			{#each options as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
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
		<!-- Gated on content: an outage/empty index shouldn't present dead facet controls over
		     the "no papers" message. Gated on `totalAll`, NOT on this page's rows — a filter that
		     matches nothing would otherwise take the filter bar away with it, stranding the visitor
		     on a "no matches" message with no control left to undo it. -->
		{#if data.totalAll > 0}
			<form
				method="GET"
				aria-label={m.research_filter_label()}
				class="glass-card grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:p-5"
				onchange={(e) => applyFilters(e.currentTarget)}
				onsubmit={(e) => {
					e.preventDefault();
					applyFilters(e.currentTarget, true);
				}}
			>
				{@render filterSelect(
					FILTER_PARAM.topic,
					m.research_filter_topic_label(),
					m.research_filter_all_topics(),
					topicSelectOptions,
					filters.topic
				)}
				<!-- The one facet that isn't a select. It carries a name OR a slug: the server resolves
				     either (`?author=dao` and `?author=tri-dao` both work), so tag-style deep links
				     keep working while a visitor can just type. `data.authorLabel` turns a slug back
				     into a readable name in the box; a typed term stays as typed.

				     The datalist is progressive enhancement over a plain text field — with JS off it
				     still offers the team seed, and typing + Apply still filters. That fallback is
				     what bounded DAR-105: the browser was filtering accented names out of the popup
				     (measured in both engines), so `luk` offered nothing while submitting it still
				     returned the paper. AuthorSuggestions carries the fix. -->
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
						{m.research_filter_author_label()}
					</span>
					<input
						type="search"
						name={FILTER_PARAM.author}
						list="research-author-options"
						autocomplete="off"
						value={data.authorLabel ?? filters.author ?? ''}
						placeholder={m.research_filter_author_placeholder()}
						class={fieldClass}
						oninput={onAuthorInput}
					/>
					<AuthorSuggestions id="research-author-options" options={authorOptions} />
				</label>
				{@render filterSelect(
					FILTER_PARAM.origin,
					m.research_filter_origin_label(),
					m.research_filter_all_origins(),
					originOptions,
					filters.origin
				)}
				{@render filterSelect(
					FILTER_PARAM.sort,
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
						<a href={localizeHref('/research')} class={mutedLinkClass}>
							{m.research_filter_clear()}
						</a>
					{/if}
				</div>
			</form>
		{/if}

		<!-- The topic taxonomy's authored descriptions (DAR-56) — a collapsed legend, plus the
		     active topic's description rendered plainly when one is filtered to. Self-guarding:
		     it renders nothing (no wrapper) when no topic has a description, so no `{#if}` here
		     and no phantom `space-y-8` gap.

		     Fed the taxonomy's own vocabulary, never this page's papers: filtering to one topic —
		     or simply being on page 3 — must not shrink the legend to what happens to be in view. -->
		<TopicGuide topics={data.topics} activeSlug={filters.topic} />

		<!-- Branching on the TOTALS, not on `data.papers.length`: that is one page now, so a filter
		     matching nothing and an empty index look identical from here. `totalAll` distinguishes
		     "nothing published" from "nothing matched", which are different messages. -->
		{#if data.totalAll === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.research_empty()}</p>
		{:else if data.total === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">
				{m.research_filter_no_matches()}
				<a href={localizeHref('/research')} class={inlineLinkClass}>{m.research_filter_clear()}</a>
			</p>
		{:else}
			<!-- Two truthful readouts rather than one awkward one: a range when there is more than a
			     page to range over, and otherwise the filtered-of-total line the index already had.
			     Merging them would print "Showing 1–1 of 1 papers." on a single result. -->
			{#if data.pageCount > 1}
				<p class="text-xs text-muted">
					{m.research_result_range({ from: data.from, to: data.to, total: data.total })}
				</p>
			{:else if filtersActive}
				<p class="text-xs text-muted">
					{m.research_filter_count({ shown: data.total, total: data.totalAll })}
				</p>
			{/if}
			{#if mergeSections}
				<!-- Title sort: one merged A–Z list — two separately-sorted sections would read as
				     broken. Origin context rides on each card (chips + disclaimer). -->
				<ul class="space-y-6">
					{#each data.papers as paper (paper._id)}
						{@render paperCard(paper)}
					{/each}
				</ul>
			{:else}
				<div class="space-y-12">
					{#if sections.darcstar.length > 0}
						{@render paperSection(
							m.research_section_darcstar_heading(),
							m.research_section_darcstar_note(),
							sections.darcstar
						)}
					{/if}

					{#if sections.external.length > 0}
						{@render paperSection(
							m.research_section_external_heading(),
							m.research_section_external_note(),
							sections.external
						)}
					{/if}
				</div>
			{/if}

			<Pager page={data.page} pageCount={data.pageCount} url={page.url} />
		{/if}
	</div>
</div>
