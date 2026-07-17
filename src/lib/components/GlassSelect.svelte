<script lang="ts">
	// Accessible single-select dropdown (issue #11) built on the maintained Zag select
	// machine (@zag-js/select via @zag-js/svelte) — the same headless engine Skeleton
	// wraps for its own components — styled entirely with our theme + glass utilities.
	// Zag owns keyboard nav, ARIA, focus management, typeahead, and popper positioning;
	// we own the look. The chosen value is exposed via $bindable so the consumer can
	// serialize it into the remote form (a hidden input).
	import * as select from '@zag-js/select';
	import { mergeProps, normalizeProps, useMachine } from '@zag-js/svelte';

	interface Option {
		value: string;
		label: string;
	}

	let {
		options,
		value = $bindable(''),
		placeholder,
		label,
		id
	}: {
		options: Option[];
		value?: string;
		placeholder: string;
		label: string;
		id: string;
	} = $props();

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
</script>

<div {...api.getRootProps()}>
	<label {...api.getLabelProps()} class="mb-1.5 block text-xs font-medium tracking-wide text-body">
		{label}
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
			<svg
				class="size-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="m6 9 6 6 6-6" />
			</svg>
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
						<svg
							class="size-4 shrink-0"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
					</span>
				</li>
			{/each}
		</ul>
	</div>
</div>
