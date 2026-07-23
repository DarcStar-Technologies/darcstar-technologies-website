<script lang="ts">
	// The admin sign-in form (#69) — shared by the standalone /login page and the navbar login
	// dialog (LoginDialog) so the two can't drift. It's a real SvelteKit form action
	// (action="/login"), so it works WITHOUT JS (native POST → sign-in → 303 to /admin) and
	// progressively enhances with use:enhance. The action routes through Better Auth's handler →
	// the router's DB-backed rate limiter (see login/+page.server.ts). The host owns the
	// surrounding chrome (heading/lead + panel or dialog); this owns the fields + submission.
	import { untrack } from 'svelte';
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
	}: {
		form?: { email?: string; error?: string; resent?: 'sent' | 'ratelimited' } | null;
		onSuccess?: () => void;
	} = $props();

	let submitting = $state(false);
	// Error from the enhanced (JS) submit; falls back to the server action's `form.error` (no-JS).
	// One generic message — wrong password, unknown account and empty fields all read the same, so
	// the form can't be used to enumerate accounts; a 429 from the rate limiter is surfaced apart.
	let clientError = $state<string | null>(null);
	const error = $derived(clientError ?? form?.error ?? null);

	// #115 resend-verification (rendered only in the 'unverified' error state below). Track the typed
	// email in state so the resend — a SEPARATE form, since it can't nest inside the sign-in form —
	// can carry it. Seeded once from the initial form value (a no-JS re-render remounts, so it stays
	// correct); untrack marks that as a deliberate one-time read, not a missed reactive dependency.
	let email = $state(untrack(() => form?.email) ?? '');
	let resending = $state(false);
	// JS resend feedback; falls back to the action result (form?.resent) so the no-JS /login page
	// still shows its confirmation after a native POST.
	let clientResend = $state<'sent' | 'ratelimited' | null>(null);
	const resendFeedback = $derived(clientResend ?? form?.resent ?? null);
	// Both forms target NAMED /login actions (the page has no `default` — see login/+page.server.ts).
	// Absolute `/login?/…` so the navbar dialog, rendered over any route, still hits /login's actions.
	const signinAction = $derived(`${localizeHref('/login')}?/signin`);
	const resendAction = $derived(`${localizeHref('/login')}?/resend`);
</script>

<form
	method="post"
	action={signinAction}
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
				: error === 'unverified'
					? m.login_error_unverified()
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
			bind:value={email}
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

<!-- #115 resend-verification affordance — shown only when a sign-in was rejected because the email is
     unverified. A SEPARATE form (it can't nest inside the sign-in form) posting to the /login `resend`
     action, which forwards to the anti-enumerating /send-verification-email. No captcha, so it works
     no-JS on the /login page; in the JS dialog the enhance callback keeps the result LOCAL (no
     applyAction) so the dialog stays open and the sign-in state is untouched. The confirmation sits
     outside the button's block so it still shows on the no-JS page (where the action result clears the
     'unverified' error, hiding the button). -->
{#if error === 'unverified'}
	<form
		method="post"
		action={resendAction}
		class="mt-4 text-sm text-body"
		use:enhance={() => {
			resending = true;
			clientResend = null;
			return async ({ result }) => {
				resending = false;
				// The action only ever fails with 429 (every other outcome is a neutral success), so a
				// failure here IS the rate limit; an unexpected error falls back to the neutral message.
				clientResend = result.type === 'failure' ? 'ratelimited' : 'sent';
			};
		}}
	>
		<input type="hidden" name="email" value={email} />
		<span>{m.login_resend_prompt()}</span>
		<button
			type="submit"
			disabled={resending}
			class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline disabled:opacity-60"
		>
			{resending ? m.login_resend_sending() : m.login_resend_button()}
		</button>
	</form>
{/if}

{#if resendFeedback === 'sent'}
	<p class="mt-2 text-sm text-success-400" role="status">{m.login_resend_sent()}</p>
{:else if resendFeedback === 'ratelimited'}
	<p class="mt-2 text-sm text-error-400" role="alert">{m.login_error_ratelimit()}</p>
{/if}
