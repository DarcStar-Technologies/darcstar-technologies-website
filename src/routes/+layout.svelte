<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon-16.svg';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-dvh flex-col">
	<Header />
	<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10">
		{@render children()}
	</main>
	<Footer />
</div>

<!-- Fixed void-coloured gradient below the header: content dissolves into the
     void before it slides under/around the glass nav. See .header-scrim. -->
<div class="header-scrim" aria-hidden="true"></div>

<BackToTop />
