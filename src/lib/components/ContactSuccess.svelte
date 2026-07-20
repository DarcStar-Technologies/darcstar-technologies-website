<script lang="ts">
	// Shared contact success confirmation — the check badge + centred title/body — used by the
	// contact modal (ContactDialog) and the standalone /contact page, so the two can't drift.
	// `dialog` picks the heading elements: the modal needs Skeleton's Dialog.Title/Description (for
	// dialog a11y), the page uses a plain h1/p page heading. The closing action (a CloseTrigger vs a
	// back-home link) differs per host, so it's a snippet.
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';
	import IconCheck from './IconCheck.svelte';

	let {
		title,
		body,
		dialog = false,
		action
	}: { title: string; body: string; dialog?: boolean; action: Snippet } = $props();
</script>

<div class="py-4 text-center">
	<div
		class="mx-auto flex size-12 items-center justify-center rounded-full bg-success-500/15 text-success-400"
	>
		<IconCheck />
	</div>
	{#if dialog}
		<Dialog.Title class="mt-4 text-2xl font-medium tracking-tight text-white">{title}</Dialog.Title>
		<Dialog.Description class="mx-auto mt-2 max-w-sm text-sm text-body">{body}</Dialog.Description>
	{:else}
		<h1 class="mt-4 text-2xl font-medium tracking-tight text-white">{title}</h1>
		<p class="mx-auto mt-2 max-w-sm text-sm text-body">{body}</p>
	{/if}
	{@render action()}
</div>
