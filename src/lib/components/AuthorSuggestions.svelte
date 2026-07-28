<script lang="ts">
	import { authorOptionLabel, type AuthorOption } from '$lib/research-filters';

	// The /research author input's <datalist>. Extracted from the page for one reason: what this
	// emits is the whole of DAR-105's fix, and nothing else in the repo can assert it. The browser's
	// own filtering of these options is unspecified and untestable from here (the popup is browser
	// chrome — a page screenshot never contains it), so the boundary this component draws is
	// deliberate: we pin what is HANDED to the browser, and the per-engine measurements that justify
	// the shape live next to `authorOptionLabel`.
	let { id, options }: { id: string; options: AuthorOption[] } = $props();
</script>

<!-- `value` is what a pick puts in the box and therefore what the filter receives; it stays the
     display name. `label` is the accent-blind match target, emitted only for the names that need
     one — see authorOptionLabel for why it carries both spellings. -->
<datalist {id}>
	{#each options as option (option.value)}
		<option value={option.label} label={authorOptionLabel(option)}></option>
	{/each}
</datalist>
