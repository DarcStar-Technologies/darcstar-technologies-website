<script lang="ts">
	// The explicit not-ours statement for third-party papers (DAR-52) — the belt to PaperOrigin's
	// chips, shared by the /research list cards + detail so the disclaimer can't drift or be
	// dropped on one surface. Same fail-safe polarity as the chips: renders unless the paper is
	// explicitly darcstarAuthored. A block <p> (it can't live inside the flex-wrap chip row);
	// `compact` is the listing card's denser variant.
	import { m } from '$lib/paraglide/messages.js';

	let {
		darcstarAuthored,
		compact = false
	}: { darcstarAuthored: boolean | null; compact?: boolean } = $props();
</script>

{#if !darcstarAuthored}
	<p class={compact ? 'mt-2 text-xs text-muted' : 'text-sm text-muted'}>
		{m.research_external_disclaimer()}
	</p>
{/if}
