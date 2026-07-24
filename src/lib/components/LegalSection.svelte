<script lang="ts">
	// One section of a legal document (/privacy · /terms): heading, optional lead paragraph,
	// optional extra content (titled lists, contact links). Shared so the two pages' section
	// shells can't drift — the DAR-44 review found five hand-copies of this markup. Sits inside
	// each page's single divided glass-card.
	import type { Snippet } from 'svelte';

	let { heading, body, children }: { heading: string; body?: string; children?: Snippet } =
		$props();
</script>

<section class="px-8 py-7 sm:px-10">
	<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">{heading}</h2>
	{#if body}
		<p class="mt-3 text-sm leading-relaxed text-body">{body}</p>
	{/if}
	{@render children?.()}
</section>
