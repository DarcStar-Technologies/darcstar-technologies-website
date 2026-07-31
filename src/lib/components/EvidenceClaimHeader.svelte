<script lang="ts">
	// The one-claim header — mono headline figure + title on a shared baseline, the dated
	// provenance line, then the claim sentence. Shared by the /evidence cards and the
	// /evidence/benchmarks kernel section so one claim's two renderings can't drift (the value
	// styling deliberately echoes the homepage readouts). All copy arrives resolved; `value` is
	// locale-invariant data per the evidence convention.
	let {
		value,
		title,
		dated,
		claim
	}: { value?: string; title: string; dated: string; claim: string } = $props();
</script>

<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
	{#if value}
		<span class="font-mono text-2xl text-white">{value}</span>
	{/if}
	<h2 class="heading-subsection">{title}</h2>
</div>
<p class="mt-1.5 font-mono text-xs tracking-wide text-muted">{dated}</p>
<p class="mt-4 text-sm leading-relaxed text-body">{claim}</p>
