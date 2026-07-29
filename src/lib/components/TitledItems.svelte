<script lang="ts">
	// A titled list inside a LegalSection — the "what we collect" / "who processes it" shape on
	// /privacy, and the assumptions-vs-axioms breakdown on /evidence/proofs (DAR-117). Extracted
	// from /privacy's local snippet when the second caller arrived: LegalSection itself exists
	// because DAR-44 found five hand-copies of the section shell, and this is the same markup one
	// level down.
	//
	// Index-keyed on purpose: the entries are static per locale, and value keys would crash
	// (each_key_duplicate) if a translation ever rendered two of them identically. h3 (not dt) so
	// the per-item titles stay in screen-reader heading navigation — the /about principles pattern.
	let { entries }: { entries: { title: string; body: string }[] } = $props();
</script>

<div class="mt-5 space-y-5">
	{#each entries as entry, i (i)}
		<div>
			<h3 class="text-base font-medium text-white">{entry.title}</h3>
			<p class="mt-1.5 text-sm leading-relaxed text-body">{entry.body}</p>
		</div>
	{/each}
</div>
