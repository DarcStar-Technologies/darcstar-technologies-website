<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Footer from './Footer.svelte';

	const { Story } = defineMeta({
		title: 'Components/Footer',
		component: Footer,
		tags: ['autodocs']
	});
</script>

<!-- The composed site footer — trust signals, secondary nav, and social/contact links — shown on
     the dark void it renders against in the app. Copy comes from Paraglide (base locale). -->
<Story name="Default" />
