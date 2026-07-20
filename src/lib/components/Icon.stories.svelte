<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Icon from './Icon.svelte';

	const { Story } = defineMeta({
		title: 'Components/Icon',
		component: Icon,
		tags: ['autodocs'],
		argTypes: {
			strokeWidth: { control: { type: 'number', min: 1, max: 3, step: 0.5 } }
		}
	});

	// The stroke line-icon set used across the UI. `Icon` takes the shapes as children so callers
	// keep the raw <path> data; these mirror the actual glyphs shipped in the app.
	const ICONS = [
		{ label: 'close', d: 'M18 6 6 18M6 6l12 12' },
		{ label: 'check', d: 'M20 6 9 17l-5-5' },
		{ label: 'arrow-up', d: 'M12 19V5M5 12l7-7 7 7' },
		{ label: 'chevron', d: 'm6 9 6 6 6-6' },
		{ label: 'menu', d: 'M3 6h18M3 12h18M3 18h18' }
	];
</script>

<Story name="Gallery">
	<div class="flex flex-wrap gap-6 text-white">
		{#each ICONS as { label, d } (label)}
			<div class="flex flex-col items-center gap-2">
				<Icon class="size-8">
					<path {d} />
				</Icon>
				<span class="text-xs text-faint">{label}</span>
			</div>
		{/each}
	</div>
</Story>

<Story name="Stroke widths">
	<div class="flex items-end gap-6 text-white">
		{#each [1.5, 2, 2.5] as sw (sw)}
			<div class="flex flex-col items-center gap-2">
				<Icon class="size-8" strokeWidth={sw}>
					<path d="M18 6 6 18M6 6l12 12" />
				</Icon>
				<span class="text-xs text-faint">{sw}</span>
			</div>
		{/each}
	</div>
</Story>
