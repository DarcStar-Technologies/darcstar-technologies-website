<script lang="ts">
	// The admin sign-in form (#69) — shared by the standalone /login page and the navbar login
	// dialog (LoginDialog) so the two can't drift. Sign-in runs through the Better Auth client so
	// the POST hits /api/auth/sign-in/email → the router's DB-backed rate limiter (a direct
	// auth.api call would skip the router, and the limiter with it). The host owns the surrounding
	// chrome (heading/lead + panel or dialog); this owns the fields + submission.
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { m } from '$lib/paraglide/messages.js';
	import { fieldClass } from '$lib/components/ContactFields.svelte';

	// `onSuccess` lets a host (the dialog) react to a successful sign-in — close itself — just
	// before we navigate to /admin. The standalone page passes nothing.
	let { onSuccess }: { onSuccess?: () => void } = $props();

	let email = $state('');
	let password = $state('');
	let submitting = $state(false);
	// One generic error state — a wrong password, unknown account, and empty fields all read the
	// same ("incorrect email or password") so the form can't be used to enumerate accounts. A 429
	// from the rate limiter is surfaced separately so a locked-out operator knows to wait.
	let error = $state<'invalid' | 'ratelimited' | null>(null);

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		submitting = true;
		error = null;

		const res = await authClient.signIn.email({ email, password });
		if (res.error) {
			error = res.error.status === 429 ? 'ratelimited' : 'invalid';
			submitting = false;
			return;
		}

		onSuccess?.();
		// Full server navigation so the /admin guard re-runs with the freshly-set session cookie.
		await goto('/admin', { invalidateAll: true });
	}
</script>

<form method="post" class="mt-6 space-y-4" onsubmit={signIn}>
	{#if error}
		<p
			class="rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-400"
			role="alert"
		>
			{error === 'ratelimited' ? m.login_error_ratelimit() : m.login_error()}
		</p>
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
			bind:value={password}
			required
			autocomplete="current-password"
			class={fieldClass}
			placeholder={m.login_field_password_placeholder()}
		/>
	</label>

	<button
		type="submit"
		disabled={submitting}
		class="glass-btn w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
	>
		{submitting ? m.login_submitting() : m.login_submit()}
	</button>
</form>
