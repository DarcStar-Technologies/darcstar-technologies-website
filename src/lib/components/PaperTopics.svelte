<script lang="ts">
	// Research-topic tags for a Sanity `paper` — the "what is it about" taxonomy (the Studio's
	// `topic` type; distinct from the site-section `category`). Tertiary (R) accent: the paper meta
	// rail color-codes the brand triad — R = topic, G = DarcStar commentary, B = links/published
	// status. `description` (fetched by the detail query only) becomes a hover tooltip. Renders
	// nothing without topics. Shared by the /research list + detail.
	import { pillClass } from '$lib/components/PaperStatus.svelte';

	type Topic = { _id: string; title: string | null; description?: string | null };
	let { topics }: { topics: Topic[] | null } = $props();
</script>

{#if topics && topics.length > 0}
	<div class="flex flex-wrap gap-2">
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
