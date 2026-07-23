<script lang="ts">
	// Password-reset request page (step 1). Standalone utility page (centred glass-card, matching
	// /login and /signup), noindex. A real form action, so it works WITHOUT JS (no Turnstile here);
	// progressively enhanced with use:enhance. On success the action returns `{ ok }` and the page
	// swaps to a generic "check your email" panel — the copy is deliberately non-committal ("if an
	// account exists…") so the page can't be used to tell which emails are registered.
	import { enhance, applyAction } from '$app/forms';
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let submitting = $state(false);
	const error = $derived(form?.error ?? null);

	function errorMessage(code: string): string {
		switch (code) {
			case 'missing':
				return m.forgot_password_error_missing();
			case 'ratelimited':
				return m.forgot_password_error_ratelimit();
			default:
				return m.forgot_password_error();
		}
	}
</script>

<Seo
	title={m.forgot_password_page_title()}
	description={m.forgot_password_page_description()}
	noindex
/>

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-sm p-6 text-left sm:p-8">
		<p class="eyebrow text-xs tracking-[0.25em]">{m.forgot_password_eyebrow()}</p>

		{#if form?.ok}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.forgot_password_check_email_heading()}
			</h1>
			<p class="mt-3 text-sm text-body">
				{m.forgot_password_check_email_body({ email: form.email })}
			</p>
			<p class="mt-2 text-xs text-body/70">{m.forgot_password_check_email_hint()}</p>
			<p class="mt-6 text-sm text-body">
				<a
					class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
					href={localizeHref('/login')}>{m.forgot_password_back_to_login()}</a
				>
			</p>
		{:else}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.forgot_password_heading()}
			</h1>
			<p class="mt-2 text-sm text-body">{m.forgot_password_lead()}</p>

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

				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
						{m.forgot_password_field_email_label()}
					</span>
					<input
						type="email"
						name="email"
						value={form?.email ?? ''}
						required
						autocomplete="username"
						class={fieldClass}
						placeholder={m.forgot_password_field_email_placeholder()}
					/>
				</label>

				<button type="submit" disabled={submitting} class={submitButtonClass}>
					{submitting ? m.forgot_password_submitting() : m.forgot_password_submit()}
				</button>
			</form>

			<p class="mt-6 text-sm text-body">
				<a
					class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
					href={localizeHref('/login')}>{m.forgot_password_back_to_login()}</a
				>
			</p>
		{/if}
	</div>
</section>
