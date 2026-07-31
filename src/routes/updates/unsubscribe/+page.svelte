<script lang="ts">
	// Unsubscribe from product-and-research updates (DAR-139) — the landing page for the `u1` link.
	// Same mold as its confirm sibling: standalone utility page, noindex, no JS required, and the
	// mutation is a POST (RFC 8058's reason, and DAR-75's).
	//
	// THREE OUTCOMES, not four: the store's withdrawal is unconditional, so there is no state this can
	// refuse from. Pressing the button on an address that never confirmed anything works, which is the
	// point — the person most likely to be here is somebody whose address a stranger typed into the
	// form and who wants the asking to stop.
	import { enhance, applyAction } from '$app/forms';
	import Seo from '$lib/components/Seo.svelte';
	import UtilityPanel from '$lib/components/UtilityPanel.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { inlineLinkClass, submitButtonClass } from '$lib/styles';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	const showInvalid = $derived(data.invalid || form?.result === 'invalid');
	const token = $derived(form?.token ?? data.token ?? '');
</script>

<Seo
	title={m.updates_unsubscribe_page_title()}
	description={m.updates_unsubscribe_page_description()}
	noindex
/>

<CosmicBackdrop />

<UtilityPanel>
	<p class="eyebrow-panel">{m.updates_eyebrow()}</p>

	{#if form?.result === 'unsubscribed'}
		<h1 class="mt-3 heading-page">
			{m.updates_unsubscribe_done_heading()}
		</h1>
		<p class="mt-3 text-sm text-body">{m.updates_unsubscribe_done_body()}</p>
	{:else if showInvalid}
		<h1 class="mt-3 heading-page">
			{m.updates_invalid_heading()}
		</h1>
		<p class="mt-3 text-sm text-body">{m.updates_invalid_body()}</p>
		<p class="mt-6 text-sm text-body">
			<a class={inlineLinkClass} href={localizeHref('/contact')}>{m.updates_contact_link()}</a>
		</p>
	{:else}
		<h1 class="mt-3 heading-page">
			{m.updates_unsubscribe_heading()}
		</h1>
		<p class="mt-2 text-sm text-body">{m.updates_unsubscribe_lead()}</p>

		<form
			method="post"
			class="mt-6 space-y-4"
			use:enhance={() => {
				submitting = true;
				return async ({ result }) => {
					submitting = false;
					await applyAction(result);
				};
			}}
		>
			<!-- Shown rather than swallowed: telling somebody their withdrawal went through when the
			     write threw is the single worst answer this page can give.
			     `ErrorBanner` rather than a styled <p>, and `role="alert"` is the whole reason: an
			     enhanced submit does not navigate, so without it a screen-reader user presses
			     Unsubscribe, hears nothing, and leaves believing it worked. -->
			{#if form?.result === 'error'}
				<ErrorBanner>{m.updates_error_body()}</ErrorBanner>
			{/if}

			<input type="hidden" name="token" value={token} />
			<button type="submit" disabled={submitting} class={submitButtonClass}>
				{submitting ? m.updates_unsubscribe_submitting() : m.updates_unsubscribe_submit()}
			</button>
		</form>
	{/if}
</UtilityPanel>
