<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import GlassSelect, { type Option } from './GlassSelect.svelte';

	// Sample options mirroring the contact form's "area of interest" picker.
	const OPTIONS: Option[] = [
		{ value: 'robotics', label: 'Robotics & control' },
		{ value: 'markets', label: 'Financial markets' },
		{ value: 'formal-methods', label: 'Formal methods & verification' },
		{ value: 'partnership', label: 'Partnership' },
		{ value: 'other', label: 'Something else' }
	];

	const { Story } = defineMeta({
		title: 'Components/GlassSelect',
		component: GlassSelect,
		tags: ['autodocs'],
		args: {
			label: 'Area of interest',
			placeholder: 'Select an area…',
			options: OPTIONS
		}
	});
</script>

<!-- `id` is distinct per story (Zag keys its DOM ids off it, so shared ids would collide when the
     autodocs page renders both at once). -->
<Story name="Default" args={{ id: 'sb-glass-default' }} />

<Story name="Preselected" args={{ id: 'sb-glass-preselected', value: 'markets' }} />
