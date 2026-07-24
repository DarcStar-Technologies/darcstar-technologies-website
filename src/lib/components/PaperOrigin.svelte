<script lang="ts">
	// Origin chip(s) for a Sanity `paper` — the visible rail that keeps third-party work from
	// reading as ours (DAR-52). First-party entries render nothing; anything NOT explicitly
	// `darcstarAuthored` is marked "Third-party" (null counts as external — the fail-safe
	// direction), plus a "DarcStar commentary" chip when we've annotated the entry
	// (`hasCommentary`, list view only — the detail page shows the commentary itself). Shared by
	// the /research list + detail; PaperExternalDisclaimer carries the block-level not-ours
	// statement that can't live in this flex-row chip rail.
	import { m } from '$lib/paraglide/messages.js';
	import { pillClass } from '$lib/components/PaperStatus.svelte';

	let {
		darcstarAuthored,
		hasCommentary = false
	}: { darcstarAuthored: boolean | null; hasCommentary?: boolean } = $props();
</script>

{#if !darcstarAuthored}
	<span class="{pillClass} border-hairline text-muted">
		{m.research_external_badge()}
	</span>
	{#if hasCommentary}
		<span class="{pillClass} border-secondary-500/40 text-secondary-400">
			{m.research_commentary_badge()}
		</span>
	{/if}
{/if}
