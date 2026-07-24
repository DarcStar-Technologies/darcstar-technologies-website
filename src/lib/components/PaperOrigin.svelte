<script lang="ts">
	// Origin chip(s) for a Sanity `paper` — the visible rail that keeps third-party work from
	// reading as ours (DAR-52). First-party entries render nothing; anything NOT explicitly
	// `darcstarAuthored` is marked "Third-party" (null counts as external — the fail-safe
	// direction), plus a "DarcStar commentary" chip when we've annotated the entry
	// (`hasCommentary`, list view only). Shared by the /research list + detail so the origin
	// never renders inconsistently. Sits beside PaperStatus and matches its chip styling.
	import { m } from '$lib/paraglide/messages.js';

	let {
		darcstarAuthored,
		hasCommentary = false
	}: { darcstarAuthored: boolean | null; hasCommentary?: boolean } = $props();
</script>

{#if !darcstarAuthored}
	<span
		class="inline-flex items-center rounded-full border border-hairline px-2.5 py-0.5 text-xs font-medium text-muted"
	>
		{m.research_external_badge()}
	</span>
	{#if hasCommentary}
		<span
			class="inline-flex items-center rounded-full border border-secondary-500/40 px-2.5 py-0.5 text-xs font-medium text-secondary-400"
		>
			{m.research_commentary_badge()}
		</span>
	{/if}
{/if}
