<script lang="ts">
	// Multi-select checkbox group in the glass-field idiom (DAR-62) — GlassSelect's sibling for the
	// questions that take more than one answer (waitlist step 3's "adoption requirement"; step 4B's
	// research preferences next).
	//
	// Plain native checkboxes on purpose: no JS is involved in making it work. It submits and
	// SSR-repopulates without hydration (the remote form field's `.as('checkbox', value)` supplies the
	// name/value/checked), keyboard navigation is the browser's, and it needs no popper. The ONLY
	// enhancement is the optional `max` cap, which disables the unchecked boxes once `max` are ticked —
	// a hint, not a boundary: with JS off nothing is disabled, so the SERVER enforces the cap
	// regardless (the step validator allowlists, dedupes and truncates).
	//
	// WIRE CONTRACT: `.as('checkbox', value)` names the group `foo[]`, which is required — SvelteKit's
	// form-data conversion throws on a repeated plain `foo`, and only the `[]` suffix yields an array.
	import type { RemoteFormField } from '@sveltejs/kit';
	import type { Option } from './GlassSelect.svelte';
	import { checkboxClass, fieldBadgeClass, fieldLegendRowClass } from '$lib/styles';

	let {
		legend,
		options,
		field,
		id,
		badge,
		help,
		max
	}: {
		legend: string;
		options: Option[];
		/** Remote form field accessor for an ARRAY field (declared `string[]` on the form input type). */
		field: RemoteFormField<string[]>;
		id: string;
		/** Optional muted badge rendered next to the legend (e.g. an "optional" marker). */
		badge?: string;
		/** Optional supporting line under the legend — wired as the group's `aria-describedby`. */
		help?: string;
		/** Enhancement-only selection cap. The server enforces the real one. */
		max?: number;
	} = $props();

	// Only reference an element that exists — `aria-describedby` pointing at nothing is an a11y bug.
	const helpId = $derived(help ? `${id}-help` : undefined);

	// The field's live value (Kit keeps it in sync as the user ticks boxes, and it holds the submitted
	// values during an SSR re-render). Filtered to strings so `DeepPartial<string[]>`'s holes can't
	// count toward the cap.
	const selected = $derived.by(() => {
		const value = field.value();
		return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
	});
	const capped = $derived(max !== undefined && selected.length >= max);
</script>

<fieldset aria-describedby={helpId}>
	<legend class="mb-1.5">
		<span class={fieldLegendRowClass}>
			{legend}
			{#if badge}<span class={fieldBadgeClass}>{badge}</span>{/if}
		</span>
	</legend>
	{#if help}<p id={helpId} class="mb-2 text-xs leading-relaxed text-faint">{help}</p>{/if}

	<div class="grid gap-2 sm:grid-cols-2">
		{#each options as opt (opt.value)}
			<label
				class="glass-field flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm text-body transition-opacity has-[:checked]:text-white has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
			>
				<input
					{...field.as('checkbox', opt.value)}
					disabled={capped && !selected.includes(opt.value)}
					class={checkboxClass}
				/>
				<span>{opt.label}</span>
			</label>
		{/each}
	</div>
</fieldset>
