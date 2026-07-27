<script lang="ts">
	// Page navigation for the content indexes (/research, /news — DAR-94).
	//
	// Plain `<a href>`, never a button or a JS handler: the indexes work with JavaScript off (the
	// filter bar is a native GET form), and paging is the one control that would otherwise strand a
	// no-JS visitor on page 1 forever. `pageHref` carries every other param through, so a pager link
	// keeps the visitor's filters and sort.
	//
	// The ends render as inert `<span>`s rather than disabled links — there is no previous page to
	// point at, and a disabled anchor is a link that lies about being one.
	import { pageHref } from '$lib/pagination';
	import { m } from '$lib/paraglide/messages.js';

	let {
		page,
		pageCount,
		url
	}: {
		/** 1-based, already clamped by `pageWindow`. */
		page: number;
		pageCount: number;
		/** This page's URL — the source of the params each link preserves. */
		url: URL;
	} = $props();

	const stepClass =
		'rounded-lg px-3 py-2 text-sm font-medium transition-colors hover-focus:text-white';
</script>

<!-- Renders NOTHING (not an empty nav) for a single page: the callers space their children with
     `space-y-*`, i.e. `> * + *`, so an always-present wrapper would leave a gap below the last
     card on every unpaginated index. Same guard-free-caller convention as PaperTopics/TopicGuide. -->
{#if pageCount > 1}
	<nav aria-label={m.pager_label()} class="flex items-center justify-between gap-4">
		{#if page > 1}
			<a href={pageHref(url, page - 1)} class="{stepClass} text-body">{m.pager_previous()}</a>
		{:else}
			<span class="{stepClass} text-faint" aria-hidden="true">{m.pager_previous()}</span>
		{/if}

		<!-- aria-current="page" is deliberately absent: this is a status readout, not one of a set of
		     page links, so there is nothing for it to mark. -->
		<p class="text-xs text-muted">{m.pager_status({ page, pages: pageCount })}</p>

		{#if page < pageCount}
			<a href={pageHref(url, page + 1)} class="{stepClass} text-body">{m.pager_next()}</a>
		{:else}
			<span class="{stepClass} text-faint" aria-hidden="true">{m.pager_next()}</span>
		{/if}
	</nav>
{/if}
