<script lang="ts">
	// Research-topic tags for a Sanity `paper` — the "what is it about" taxonomy (the Studio's
	// `topic` type; distinct from the site-section `category`). Tertiary (R) accent per the
	// paper-rail charge mapping (docs/styling.md): R = topic, G = commentary, B = link/published.
	// `description` becomes a hover tooltip on both surfaces (progressive enhancement only —
	// DAR-56 tracks a visible rendering). Renders nothing without topics, so callers pass spacing
	// via `class` with no guard (the SanityImage convention). Shared by the /research list + detail.
	import { pillClass } from '$lib/components/PaperStatus.svelte';

	type Topic = { _id: string; title: string; description?: string | null };
	let { topics, class: klass }: { topics: Topic[] | null; class?: string } = $props();
</script>

{#if topics && topics.length > 0}
	<div class={['flex flex-wrap gap-2', klass]}>
		{#each topics as topic (topic._id)}
			<span
				class="{pillClass} border-tertiary-500/40 text-tertiary-400"
				title={topic.description ?? undefined}
			>
				{topic.title}
			</span>
		{/each}
	</div>
{/if}
