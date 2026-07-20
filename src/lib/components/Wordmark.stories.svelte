<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Wordmark from './Wordmark.svelte';

	const { Story } = defineMeta({
		title: 'Components/Wordmark',
		component: Wordmark,
		tags: ['autodocs']
	});
</script>

<!-- Wordmark is built to sit inside a flex link that supplies the gap + font sizing; these
     templates reproduce the header and footer contexts (see Header.svelte / Footer.svelte). -->
<Story name="Header">
	<div class="flex items-center gap-2.5 text-4xl font-bold tracking-tight text-white">
		<Wordmark markClass="size-20" />
	</div>
</Story>

<Story name="Footer">
	<div class="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
		<Wordmark markClass="size-9" />
	</div>
</Story>
