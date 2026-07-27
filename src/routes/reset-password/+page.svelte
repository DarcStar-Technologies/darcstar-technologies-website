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
	import { fieldClass, inlineLinkClass, submitButtonClass } from '$lib/styles';
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

	// Invitation mode (DAR-67) — same page, same action, same token; only the words change. An invitee
	// arriving from a staff invitation has never had a password, so every "new password" / "reset" /
	// "update" phrase is subtly wrong for them, and wrong-sounding security mail is how people learn to
	// ignore it. The flag rides in the query and survives a no-JS re-render because the form POSTs to
	// the current URL. Cosmetic only — see the load.
	const invite = $derived(data.invite);

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
	title={invite ? m.reset_password_invite_page_title() : m.reset_password_page_title()}
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
			<p class="mt-3 text-sm text-body">
				{invite ? m.reset_password_invite_success_body() : m.reset_password_success_body()}
			</p>
			<p class="mt-6 text-sm text-body">
				<a class={inlineLinkClass} href={localizeHref('/login')}
					>{m.reset_password_success_signin_link()}</a
				>
			</p>
		{:else if showInvalid}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.reset_password_invalid_heading()}
			</h1>
			<!-- The recovery link points at /forgot-password for an invitee too, and correctly: their
			     account already exists, so the ordinary reset flow will mail them a fresh link without
			     needing staff at all. Only the sentence above it changes. -->
			<p class="mt-3 text-sm text-body">
				{invite ? m.reset_password_invite_invalid_body() : m.reset_password_invalid_body()}
			</p>
			<p class="mt-6 text-sm text-body">
				<a class={inlineLinkClass} href={localizeHref('/forgot-password')}
					>{m.reset_password_invalid_request_link()}</a
				>
			</p>
		{:else}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{invite ? m.reset_password_invite_heading() : m.reset_password_heading()}
			</h1>
			<p class="mt-2 text-sm text-body">
				{invite ? m.reset_password_invite_lead() : m.reset_password_lead()}
			</p>

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
						{invite
							? m.reset_password_invite_field_password_label()
							: m.reset_password_field_password_label()}
					</span>
					<input
						type="password"
						name="password"
						required
						minlength="8"
						autocomplete="new-password"
						class={fieldClass}
						placeholder={invite
							? m.reset_password_invite_field_password_placeholder()
							: m.reset_password_field_password_placeholder()}
					/>
					<span class="mt-1.5 block text-xs text-body/70">{m.reset_password_password_hint()}</span>
				</label>

				<button type="submit" disabled={submitting} class={submitButtonClass}>
					{#if invite}
						{submitting ? m.reset_password_invite_submitting() : m.reset_password_invite_submit()}
					{:else}
						{submitting ? m.reset_password_submitting() : m.reset_password_submit()}
					{/if}
				</button>
			</form>
		{/if}
	</div>
</section>
