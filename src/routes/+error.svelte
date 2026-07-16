<script lang="ts">
	import { page } from '$app/state';
	import { localizeHref } from '$lib/paraglide/runtime';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';

	// 404 is the common case (dead/old links) and gets a bespoke line; any other
	// status falls back to the framework-supplied error message.
	let is404 = $derived(page.status === 404);
	let heading = $derived(is404 ? 'Lost in the void' : 'Something went wrong');
	let detail = $derived(
		is404
			? 'That page drifted off the map — the link may be broken, or the page may have moved.'
			: (page.error?.message ?? 'An unexpected error occurred.')
	);
</script>

<!-- Error pages carry a title but must stay out of the index (noindex). -->
<svelte:head>
	<title>{page.status} — DarcStar Technologies</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- Same cosmic void as the homepage; the canvas is fixed/-z-10 and centres its
     helix at a fallback position when there's no #helix-slot on the page. -->
<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
	<div class="glass-panel mx-auto w-full max-w-md rounded-2xl px-8 py-12 sm:px-10">
		<p class="charge-flow text-7xl font-semibold tracking-tight sm:text-8xl">{page.status}</p>
		<h1 class="mt-5 text-2xl font-medium tracking-tight text-balance text-white sm:text-3xl">
			{heading}
		</h1>
		<p class="mx-auto mt-4 max-w-sm text-base text-white/70">{detail}</p>
		<div class="mt-9 flex justify-center">
			<a
				href={localizeHref('/')}
				class="glass-btn rounded-full px-6 py-2.5 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10"
			>
				Return home →
			</a>
		</div>
	</div>
</section>
