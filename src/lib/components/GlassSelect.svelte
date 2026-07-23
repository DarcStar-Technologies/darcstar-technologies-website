<script module lang="ts">
	// A single dropdown option — the shape ContactDialog builds and the test harness reuses.
	// Exported so those consumers share one source instead of re-declaring it.
	export interface Option {
		value: string;
		label: string;
	}
</script>

<script lang="ts">
	// Accessible single-select dropdown (issue #11) built on the maintained Zag select
	// machine (@zag-js/select via @zag-js/svelte) — the same headless engine Skeleton
	// wraps for its own components — styled entirely with our theme + glass utilities.
	// Zag owns keyboard nav, ARIA, focus management, typeahead, and popper positioning;
	// we own the look.
	//
	// PROGRESSIVE ENHANCEMENT (the `field` prop): the frosted glass menu is JS-only, so a
	// no-JS page (e.g. /waitlist) would be left with a dead control. Pass `field` — the
	// remote form's field accessor — and GlassSelect owns its own serialization: it renders
	// a native <select> (glass-field styled, submits + SSR-repopulates without JS) on the
	// server and until hydration, then swaps to the glass menu (with a hidden input carrying
	// the value) once mounted. Omit `field` (the ContactDialog modal, which is JS-only) to
	// keep the always-on glass menu; the caller then supplies its own hidden input and binds
	// `value`.
	import * as select from '@zag-js/select';
	import { mergeProps, normalizeProps, useMachine } from '@zag-js/svelte';
	import { onMount } from 'svelte';
	import type { RemoteFormField } from '@sveltejs/kit';
	import Icon from './Icon.svelte';
	import IconCheck from './IconCheck.svelte';

	let {
		options,
		value = $bindable(''),
		placeholder,
		label,
		id,
		field,
		badge
	}: {
		options: Option[];
		value?: string;
		placeholder: string;
		label: string;
		id: string;
		/** Remote form field accessor. When set, GlassSelect renders a no-JS native-<select>
		 *  fallback that upgrades to the glass menu on hydration, and serializes itself. */
		field?: RemoteFormField<string>;
		/** Optional muted badge rendered next to the label (e.g. an "optional" marker). */
		badge?: string;
	} = $props();

	// Render the native <select> on the server and until mount, then swap to the Zag glass
	// menu. With `field` present the native control is what submits without JS; after mount
	// the glass menu takes over and a hidden input carries the value.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		// If JS arrives after an SSR validation re-render, carry the repopulated value into
		// the menu so the trigger doesn't reset to the placeholder.
		if (field && !value) {
			const v = field.value();
			if (typeof v === 'string') value = v;
		}
	});

	// Spreadable native-<select> props (name + bound value + aria-invalid) for the no-JS
	// fallback; also the source of the field name for the hydrated hidden input. Computed
	// once (field is stable) — its `value` getter/setter stays live-bound to the field.
	const asSelect = $derived(field?.as('select'));

	const collection = $derived(
		select.collection({
			items: options,
			itemToString: (o) => o.label,
			itemToValue: (o) => o.value
		})
	);

	const service = useMachine(select.machine, () => ({
		id,
		collection,
		value: value ? [value] : [],
		onValueChange: (details: { value: string[] }) => (value = details.value[0] ?? ''),
		positioning: { sameWidth: true }
	}));
	const api = $derived(select.connect(service, normalizeProps));

	const labelClass = 'mb-1.5 flex items-baseline gap-2 text-xs font-medium tracking-wide text-body';
</script>

{#if field && !mounted}
	<!-- No-JS / pre-hydration fallback: a native <select> styled to match the glass fields
	     (the CSS chevron affordance in layout.css renders without JS). It carries the field
	     name + submitted value via {...asSelect}, so it submits and SSR-repopulates. -->
	<label class="block">
		<span class={labelClass}>
			{label}
			{#if badge}<span class="font-normal text-faint">{badge}</span>{/if}
		</span>
		<select {...asSelect} {id} class="glass-field w-full rounded-lg px-3.5 py-2.5 text-sm">
			<option value="">{placeholder}</option>
			{#each options as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</label>
{:else}
	<div {...api.getRootProps()}>
		<label {...api.getLabelProps()} class={labelClass}>
			{label}
			{#if badge}<span class="font-normal text-faint">{badge}</span>{/if}
		</label>

		<button
			{...api.getTriggerProps()}
			class="glass-field flex w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm"
		>
			<span {...api.getValueTextProps()} class={api.value.length ? 'text-white' : 'text-subtle'}>
				{api.valueAsString || placeholder}
			</span>
			<span
				{...api.getIndicatorProps()}
				class="flex shrink-0 text-faint transition-transform duration-150 data-[state=open]:rotate-180"
			>
				<Icon class="size-4">
					<path d="m6 9 6 6 6-6" />
				</Icon>
			</span>
		</button>

		<!-- Zag sets the positioner's z-index inline (a class can't win); lift it above the
		     form's glass-btn, whose backdrop-filter also makes it a z-auto stacking context. -->
		<div {...mergeProps(api.getPositionerProps(), { style: 'z-index: 70' })}>
			<!-- Frosted glass menu — grain + sheen + blur + lift over a dark-enough base to
			     stay legible above the form fields (see `glass-menu` in layout.css). -->
			<ul
				{...api.getContentProps()}
				class="glass-menu max-h-60 overflow-auto rounded-xl p-1 focus:outline-none"
			>
				{#each options as opt (opt.value)}
					<li
						{...api.getItemProps({ item: opt })}
						class="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-emphasis transition-colors data-[highlighted]:bg-primary-500/25 data-[highlighted]:text-white data-[state=checked]:text-white"
					>
						<span {...api.getItemTextProps({ item: opt })}>{opt.label}</span>
						<span {...api.getItemIndicatorProps({ item: opt })} class="text-primary-400">
							<IconCheck class="size-4 shrink-0" strokeWidth={2.5} />
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
	<!-- The glass menu isn't a form control; ride the value into FormData under the field name. -->
	{#if asSelect}
		<input type="hidden" name={asSelect.name} {value} />
	{/if}
{/if}
