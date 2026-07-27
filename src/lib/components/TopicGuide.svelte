<script lang="ts">
	// The /research topic taxonomy's authored descriptions, rendered so a human can actually read
	// them (DAR-56). The Studio's `topic.description` field says it is "shown alongside the papers
	// tagged with it", but it only ever reached a `title` tooltip on the PaperTopics tags — which
	// needs a pointer, so on touch it does not exist, and a keyboard reaching the tag (it IS a
	// link) still gets nothing. The tooltip stays as progressive enhancement; this is the rendering.
	//
	// Two surfaces, because they answer different questions and one can't do both jobs:
	//   - the <details> legend answers "what does this taxonomy mean" while browsing unfiltered,
	//     collapsed so it costs one line for the many visitors who never ask;
	//   - the active-topic block answers "what is the thing I just tapped", VISIBLE with nothing to
	//     open — which is what closes the loop for the touch user in the ticket: tap a tag on a
	//     card, land on ?topic=<slug>, read the description. A disclosure there would just be the
	//     tooltip's problem again with a different gesture.
	//
	// Plain SSR HTML on both: <details> is natively keyboard- and touch-operable, so the whole
	// component works with JS off, like the filter form above it.
	import { researchTopicHref, type TopicEntry } from '$lib/research-filters';
	import { m } from '$lib/paraglide/messages.js';

	let {
		topics,
		activeSlug = null,
		class: klass
	}: {
		/** Every topic in use by the index — NOT the filtered subset. See `described` below. */
		topics: TopicEntry[];
		/** The `?topic=` filter in force, if any. */
		activeSlug?: string | null;
		class?: string;
	} = $props();

	// An undescribed topic has nothing to render — it would be a title echoing the facet select.
	// Deriving from the caller's FULL topic list (not the filtered papers) is deliberate: filtering
	// to one topic must not shrink the legend to one entry, because the legend explains the
	// taxonomy rather than the current result set.
	const described = $derived(topics.filter((t) => t.description));
	const active = $derived(described.find((t) => t.slug === activeSlug) ?? null);

	// `list-none` + the -webkit- rule replace the native disclosure triangle with the caret below.
	// Both are needed: Chrome drops the marker anyway once `display` isn't `list-item`, Firefox
	// needs `list-style`, and older WebKit needs its pseudo-element hidden.
	// One literal, never concatenated: Tailwind's scanner reads raw source text, so a class split
	// across a `+` boundary would silently never compile.
	const summaryClass =
		'inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-xs text-muted transition-colors hover-focus:text-white [&::-webkit-details-marker]:hidden';
</script>

<!-- Renders NOTHING (not an empty wrapper) when no topic carries a description: the parent's
     `space-y-8` is `> * + *`, so an always-present wrapper div would leave a gap where this
     component is invisible. Same guard-free-caller convention as PaperTopics/SanityImage. -->
{#if described.length > 0}
	<div class={['space-y-4', klass]}>
		<details class="group">
			<summary class={summaryClass}>
				<span class="text-tertiary-400 transition-transform group-open:rotate-90" aria-hidden="true"
					>▸</span
				>
				{m.research_topics_legend_summary()}
			</summary>
			<dl class="glass-card mt-3 space-y-3 p-5 text-sm">
				{#each described as topic (topic.slug)}
					<div>
						<dt class="font-medium text-tertiary-400">
							<a
								href={researchTopicHref(topic.slug)}
								class="underline-offset-4 transition-colors hover-focus:text-tertiary-300 hover-focus:underline"
							>
								{topic.title}
							</a>
						</dt>
						<dd class="mt-0.5 leading-relaxed text-body">{topic.description}</dd>
					</div>
				{/each}
			</dl>
		</details>

		<!-- The filtered view's own header. Deliberately NOT a `glass-card`: the cards below are the
		     papers, and a third frosted panel between the filter bar and them would read as one
		     more result. The tertiary rule ties it to the topic charge (docs/sanity.md). -->
		{#if active}
			<div class="border-l-2 border-tertiary-500/40 pl-4">
				<p class="text-xs font-medium tracking-wide text-faint">
					{m.research_filter_topic_label()}
				</p>
				<h2 class="mt-0.5 text-xl font-medium tracking-tight text-white">{active.title}</h2>
				<p class="mt-1 text-sm leading-relaxed text-body">{active.description}</p>
			</div>
		{/if}
	</div>
{/if}
