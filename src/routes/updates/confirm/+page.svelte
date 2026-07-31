<script lang="ts">
	// Confirm product-and-research updates (DAR-139) — the landing page for the `c1` link in the
	// confirmation email. Standalone utility page on the /reset-password mold, noindex, and it works
	// with no JS because the whole thing is a real form action.
	//
	// FOUR OUTCOMES, all of them from the server: confirmed (including a second press, which the store
	// makes idempotent), opted out (this address withdrew, and a stale confirmation link does not undo
	// that), the generic "link didn't work", and a database failure. The last is shown rather than
	// swallowed — somebody acting on their own consent has to be told when nothing was recorded.
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
	// The link was unreadable when the page loaded, OR it failed at submit time (expired in between, or
	// the lead was deleted). One panel either way — the server folds every cause into `invalid`.
	const showInvalid = $derived(data.invalid || form?.result === 'invalid');
	// Keep the token across a no-JS re-render: the action echoes it back.
	const token = $derived(form?.token ?? data.token ?? '');
</script>

<Seo
	title={m.updates_confirm_page_title()}
	description={m.updates_confirm_page_description()}
	noindex
/>

<CosmicBackdrop />

<UtilityPanel>
	<p class="eyebrow-panel">{m.updates_eyebrow()}</p>

	{#if form?.result === 'confirmed'}
		<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
			{m.updates_confirm_done_heading()}
		</h1>
		<p class="mt-3 text-sm text-body">{m.updates_confirm_done_body()}</p>
	{:else if form?.result === 'unsubscribed'}
		<!-- A confirmation link found after unsubscribing. The store refuses to re-subscribe (the
		     form is the surface a stranger controls, so a withdrawal has to outlast anything reachable
		     from it), and this says so instead of pretending the press did nothing. -->
		<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
			{m.updates_confirm_optedout_heading()}
		</h1>
		<p class="mt-3 text-sm text-body">{m.updates_confirm_optedout_body()}</p>
		<p class="mt-6 text-sm text-body">
			<a class={inlineLinkClass} href={localizeHref('/contact')}>{m.updates_contact_link()}</a>
		</p>
	{:else if showInvalid}
		<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
			{m.updates_invalid_heading()}
		</h1>
		<p class="mt-3 text-sm text-body">{m.updates_invalid_body()}</p>
		<p class="mt-6 text-sm text-body">
			<a class={inlineLinkClass} href={localizeHref('/contact')}>{m.updates_contact_link()}</a>
		</p>
	{:else}
		<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
			{m.updates_confirm_heading()}
		</h1>
		<p class="mt-2 text-sm text-body">{m.updates_confirm_lead()}</p>

		<!-- A POST, and that is the security property rather than a convention: a link previewer or a
		     mail scanner fetching the URL must not be able to record somebody's consent. -->
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
			<!-- `ErrorBanner`, not a styled <p>: it carries role="alert", and an enhanced submit does
			     not navigate — so without it a screen-reader user presses the button, hears nothing,
			     and has no way to know the write failed. Same component every other form here uses. -->
			{#if form?.result === 'error'}
				<ErrorBanner>{m.updates_error_body()}</ErrorBanner>
			{/if}

			<input type="hidden" name="token" value={token} />
			<button type="submit" disabled={submitting} class={submitButtonClass}>
				{submitting ? m.updates_confirm_submitting() : m.updates_confirm_submit()}
			</button>
		</form>
	{/if}
</UtilityPanel>
