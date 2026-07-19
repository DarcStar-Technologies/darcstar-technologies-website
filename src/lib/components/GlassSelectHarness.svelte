<script lang="ts">
	// Test-only wrapper (used by GlassSelect.svelte.test.ts). Renders GlassSelect with a
	// two-way bound value mirrored into a hidden input — exactly how ContactDialog wires
	// it — so a component test can assert the bound value actually reaches the form.
	import GlassSelect, { type Option } from './GlassSelect.svelte';

	let { options, placeholder, label }: { options: Option[]; placeholder: string; label: string } =
		$props();
	let value = $state('');
</script>

<GlassSelect id="harness" {label} {placeholder} {options} bind:value />
<input type="hidden" name="interest" {value} />
