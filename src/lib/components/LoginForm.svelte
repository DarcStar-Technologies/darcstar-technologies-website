<script lang="ts">
	// The admin sign-in form (#69) — shared by the standalone /login page and the navbar login
	// dialog (LoginDialog) so the two can't drift. It's a real SvelteKit form action
	// (action="/login"), so it works WITHOUT JS (native POST → sign-in → 303 to /admin) and
	// progressively enhances with use:enhance. The action routes through Better Auth's handler →
	// the router's DB-backed rate limiter (see login/+page.server.ts). The host owns the
	// surrounding chrome (heading/lead + panel or dialog); this owns the fields + submission.
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';

	// `form` is the /login action result — present when the page re-renders after a no-JS submit,
	// to repopulate the email + show the error. `onSuccess` lets the dialog close on success.
	let {
		form,
		onSuccess
	}: { form?: { email?: string; error?: string } | null; onSuccess?: () => void } = $props();

	let submitting = $state(false);
	// Error from the enhanced (JS) submit; falls back to the server action's `form.error` (no-JS).
	// One generic message — wrong password, unknown account and empty fields all read the same, so
	// the form can't be used to enumerate accounts; a 429 from the rate limiter is surfaced apart.
	let clientError = $state<string | null>(null);
	const error = $derived(clientError ?? form?.error ?? null);
</script>

<form
	method="post"
	action={localizeHref('/login')}
	class="mt-6 space-y-4"
	use:enhance={() => {
		submitting = true;
		clientError = null;
		return async ({ result }) => {
			submitting = false;
			if (result.type === 'redirect') {
				onSuccess?.();
				await goto(result.location, { invalidateAll: true });
			} else if (result.type === 'failure') {
				clientError = (result.data as { error?: string } | undefined)?.error ?? 'invalid';
			} else {
				// result.type === 'error' — an unexpected server error, not a credential problem.
				clientError = 'generic';
			}
		};
	}}
>
	{#if error}
		<ErrorBanner>
			{error === 'ratelimited'
				? m.login_error_ratelimit()
				: error === 'generic'
					? m.login_error_generic()
					: m.login_error()}
		</ErrorBanner>
	{/if}

	<label class="block">
		<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
			{m.login_field_email_label()}
		</span>
		<input
			type="email"
			name="email"
			value={form?.email ?? ''}
			required
			autocomplete="username"
			class={fieldClass}
			placeholder={m.login_field_email_placeholder()}
		/>
	</label>

	<label class="block">
		<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
			{m.login_field_password_label()}
		</span>
		<input
			type="password"
			name="password"
			required
			autocomplete="current-password"
			class={fieldClass}
			placeholder={m.login_field_password_placeholder()}
		/>
	</label>

	<button type="submit" disabled={submitting} class={submitButtonClass}>
		{submitting ? m.login_submitting() : m.login_submit()}
	</button>
</form>
