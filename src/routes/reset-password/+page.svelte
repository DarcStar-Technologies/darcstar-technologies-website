<script lang="ts">
	// Password-reset page (step 2 — the emailed link lands here). Standalone utility page matching
	// /login, noindex. Three states: the new-password form; a success panel (link changed → go sign
	// in); and an "invalid or expired link" panel (no/failed token → request a fresh link). Works
	// WITHOUT JS (a real form action); progressively enhanced with use:enhance. The token rides in a
	// hidden field so a no-JS re-render doesn't depend on the URL keeping its query string.
	import { enhance, applyAction } from '$app/forms';
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	const error = $derived(form?.error ?? null);
	// A bad/missing token from the link (data.invalid) OR a token that failed at submit time (expired
	// between load and submit, or already used) → the "invalid link" state.
	const showInvalid = $derived(data.invalid || error === 'invalid_token');
	// Keep the token across a no-JS failure re-render: the action echoes it back on recoverable fails.
	const token = $derived(form?.token ?? data.token ?? '');

	function errorMessage(code: string): string {
		switch (code) {
			case 'missing':
				return m.reset_password_error_missing();
			case 'password_short':
				return m.reset_password_error_password_short();
			case 'ratelimited':
				return m.reset_password_error_ratelimit();
			default:
				return m.reset_password_error();
		}
	}
</script>

<Seo
	title={m.reset_password_page_title()}
	description={m.reset_password_page_description()}
	noindex
/>

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-sm p-6 text-left sm:p-8">
		<p class="eyebrow text-xs tracking-[0.25em]">{m.reset_password_eyebrow()}</p>

		{#if form?.ok}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.reset_password_success_heading()}
			</h1>
			<p class="mt-3 text-sm text-body">{m.reset_password_success_body()}</p>
			<p class="mt-6 text-sm text-body">
				<a
					class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
					href={localizeHref('/login')}>{m.reset_password_success_signin_link()}</a
				>
			</p>
		{:else if showInvalid}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.reset_password_invalid_heading()}
			</h1>
			<p class="mt-3 text-sm text-body">{m.reset_password_invalid_body()}</p>
			<p class="mt-6 text-sm text-body">
				<a
					class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
					href={localizeHref('/forgot-password')}>{m.reset_password_invalid_request_link()}</a
				>
			</p>
		{:else}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.reset_password_heading()}
			</h1>
			<p class="mt-2 text-sm text-body">{m.reset_password_lead()}</p>

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
				{#if error}
					<ErrorBanner>{errorMessage(error)}</ErrorBanner>
				{/if}

				<input type="hidden" name="token" value={token} />

				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
						{m.reset_password_field_password_label()}
					</span>
					<input
						type="password"
						name="password"
						required
						minlength="8"
						autocomplete="new-password"
						class={fieldClass}
						placeholder={m.reset_password_field_password_placeholder()}
					/>
					<span class="mt-1.5 block text-xs text-body/70">{m.reset_password_password_hint()}</span>
				</label>

				<button type="submit" disabled={submitting} class={submitButtonClass}>
					{submitting ? m.reset_password_submitting() : m.reset_password_submit()}
				</button>
			</form>
		{/if}
	</div>
</section>
