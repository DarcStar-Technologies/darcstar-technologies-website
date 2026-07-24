<script lang="ts">
	// Research-topic tags for a Sanity `paper` — the "what is it about" taxonomy (the Studio's
	// `topic` type; distinct from the site-section `category`). Tertiary (R) accent per the
	// paper-rail charge mapping (docs/sanity.md): R = topic, G = commentary, B = link/published.
	// `description` becomes a hover tooltip (progressive enhancement only — DAR-56 tracks a
	// visible rendering). With `topicHref`, tags render as LINKS into the filtered /research
	// view (?topic=slug), so a tag is never a dead end. Renders nothing without topics, so
	// callers pass spacing via `class` with no guard (the SanityImage convention).
	import { pillClass } from '$lib/components/PaperStatus.svelte';

	type Topic = { _id: string; title: string; slug?: string | null; description?: string | null };
	let {
		topics,
		class: klass,
		topicHref
	}: {
		topics: Topic[] | null;
		class?: string;
		/** Maps a topic slug to a filter URL; tags with a slug render as anchors when set. */
		topicHref?: (slug: string) => string;
	} = $props();

	const tagClass = `${pillClass} border-tertiary-500/40 text-tertiary-400`;
</script>

{#if topics && topics.length > 0}
	<div class={['flex flex-wrap gap-2', klass]}>
		{#each topics as topic (topic._id)}
			{#if topicHref && topic.slug}
				<a
					href={topicHref(topic.slug)}
					class="{tagClass} transition-colors hover:border-tertiary-400 hover:text-tertiary-300"
					title={topic.description ?? undefined}
				>
					{topic.title}
				</a>
			{:else}
				<span class={tagClass} title={topic.description ?? undefined}>
					{topic.title}
				</span>
			{/if}
		{/each}
	</div>
{/if}
