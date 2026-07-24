<script lang="ts">
	// Public sign-up page (#96 PR 2). Standalone utility page (centred glass-card, matching /login),
	// noindex. A real form action (works structurally like /login) but — unlike /login — sign-up
	// REQUIRES JS, because the Cloudflare Turnstile challenge has no no-JS path. On success the action
	// returns `{ ok }` (no redirect: requireEmailVerification means the visitor isn't signed in yet),
	// and the page swaps to a "check your email" panel. The Turnstile widget is rendered client-side
	// via an {@attach} (the repo pattern for DOM work — see CosmicBackdrop), so it renders on SPA
	// navigation too; it injects the hidden `cf-turnstile-response` field the action forwards.
	import { enhance, applyAction } from '$app/forms';
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import { inlineLinkClass } from '$lib/components/FormPrivacyNotice.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { TURNSTILE_SCRIPT_URL } from '$lib/security-headers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const siteKey = $derived(data.turnstileSiteKey);

	let submitting = $state(false);
	// Error from the enhanced (JS) submit; falls back to the server action's `form.error` (no-JS).
	let clientError = $state<string | null>(null);
	const error = $derived(clientError ?? form?.error ?? null);

	// #115 resend-verification state (check-email panel). `resend` only exists on the resend action's
	// return; guard with `in` so the discriminated `form` union narrows cleanly.
	let resending = $state(false);
	const resendState = $derived(form && 'resend' in form ? form.resend : null);

	function errorMessage(code: string): string {
		switch (code) {
			case 'missing':
				return m.signup_error_missing();
			case 'password_short':
				return m.signup_error_password_short();
			case 'captcha':
				return m.signup_error_captcha();
			case 'captcha_required':
				return m.signup_captcha_required();
			case 'ratelimited':
				return m.signup_error_ratelimit();
			default:
				return m.signup_error();
		}
	}

	// Minimal Turnstile JS surface (loaded from the CDN script below). Typed locally so the attachment
	// stays type-safe without a global ambient declaration.
	type TurnstileApi = {
		render: (el: HTMLElement, opts: { sitekey: string; theme?: string }) => string;
		reset: (id: string) => void;
		remove: (id: string) => void;
	};

	// Exposed by the attachment so a failed submit can refresh the (single-use) challenge token.
	let resetTurnstile = $state<(() => void) | undefined>(undefined);

	// Render the Turnstile widget explicitly (SPA-safe) and load the CDN script once if needed. Uses
	// `window`/`document` inside an {@attach}, the repo's sanctioned spot for DOM access (CosmicBackdrop).
	function turnstileWidget(node: HTMLDivElement) {
		if (!siteKey) return;
		const win = window as unknown as { turnstile?: TurnstileApi };
		let id: string | undefined;
		const render = () => {
			// Bail if already rendered, the script isn't ready, or this node was detached before a
			// straddling first-load fired — else we'd render an orphan widget into a detached node that
			// this (already-torn-down) closure never cleans up.
			if (id !== undefined || !win.turnstile || !node.isConnected) return;
			id = win.turnstile.render(node, { sitekey: siteKey, theme: 'dark' });
		};
		resetTurnstile = () => {
			if (id !== undefined) win.turnstile?.reset(id);
		};
		if (win.turnstile) {
			render();
		} else {
			let script = document.querySelector<HTMLScriptElement>(
				`script[src="${TURNSTILE_SCRIPT_URL}"]`
			);
			if (!script) {
				script = document.createElement('script');
				script.src = TURNSTILE_SCRIPT_URL;
				script.async = true;
				document.head.appendChild(script);
			}
			script.addEventListener('load', render, { once: true });
		}
		return () => {
			if (id !== undefined) win.turnstile?.remove(id);
			resetTurnstile = undefined;
		};
	}
</script>

<Seo title={m.signup_page_title()} description={m.signup_page_description()} noindex />

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-sm p-6 text-left sm:p-8">
		<p class="eyebrow text-xs tracking-[0.25em]">{m.signup_eyebrow()}</p>

		{#if form?.ok}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.signup_check_email_heading()}
			</h1>
			<p class="mt-3 text-sm text-body">{m.signup_check_email_body({ email: form.email })}</p>
			<p class="mt-2 text-xs text-body/70">{m.signup_check_email_hint()}</p>

			<!-- Resend affordance (#115): forwards to the anti-enumerating /send-verification-email so a
			     dropped/lost link — or a repeat sign-up whose duplicate response never mailed one — has a
			     self-service way out. No captcha (out of the widget's scope), so it works no-JS too. -->
			{#if resendState === 'sent'}
				<p class="mt-4 text-sm text-success-400" role="status">{m.signup_resend_sent()}</p>
			{:else if resendState === 'ratelimited'}
				<p class="mt-4 text-sm text-error-400" role="alert">{m.signup_error_ratelimit()}</p>
			{/if}

			<form
				method="post"
				action="?/resend"
				class="mt-2"
				use:enhance={() => {
					resending = true;
					return async ({ result }) => {
						resending = false;
						await applyAction(result);
					};
				}}
			>
				<input type="hidden" name="email" value={form.email} />
				<button
					type="submit"
					disabled={resending}
					class="text-sm font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline disabled:opacity-60"
				>
					{resending ? m.signup_resend_sending() : m.signup_resend_button()}
				</button>
			</form>

			<p class="mt-6 text-sm text-body">
				<a
					class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
					href={localizeHref('/login')}>{m.signup_have_account_link()}</a
				>
			</p>
		{:else}
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.signup_heading()}</h1>
			<p class="mt-2 text-sm text-body">{m.signup_lead()}</p>

			<form
				method="post"
				action="?/signup"
				class="mt-6 space-y-4"
				use:enhance={({ formData, cancel }) => {
					// Guard: with a widget present, don't submit an unsolved challenge (empty token).
					if (siteKey && !formData.get('cf-turnstile-response')) {
						clientError = 'captcha_required';
						cancel();
						return;
					}
					submitting = true;
					clientError = null;
					return async ({ result }) => {
						submitting = false;
						if (result.type === 'success') {
							await applyAction(result); // sets `form` → the check-email panel
						} else if (result.type === 'failure') {
							await applyAction(result); // sets `form.error`
							resetTurnstile?.(); // the token was consumed — issue a fresh challenge
						} else {
							clientError = 'generic';
							resetTurnstile?.();
						}
					};
				}}
			>
				{#if error}
					<ErrorBanner>{errorMessage(error)}</ErrorBanner>
				{/if}

				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
						{m.signup_field_name_label()}
					</span>
					<input
						type="text"
						name="name"
						value={form?.values?.name ?? ''}
						required
						autocomplete="name"
						class={fieldClass}
						placeholder={m.signup_field_name_placeholder()}
					/>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
						{m.signup_field_email_label()}
					</span>
					<input
						type="email"
						name="email"
						value={form?.values?.email ?? ''}
						required
						autocomplete="username"
						class={fieldClass}
						placeholder={m.signup_field_email_placeholder()}
					/>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body">
						{m.signup_field_password_label()}
					</span>
					<input
						type="password"
						name="password"
						required
						minlength="8"
						autocomplete="new-password"
						class={fieldClass}
						placeholder={m.signup_field_password_placeholder()}
					/>
					<span class="mt-1.5 block text-xs text-body/70">{m.signup_password_hint()}</span>
				</label>

				{#if siteKey}
					<div {@attach turnstileWidget}></div>
				{/if}

				<!-- Agreement notice (DAR-44) — a two-link variant of the shared FormPrivacyNotice,
				     on the same exported link treatment so the styles can't drift. -->
				<p class="text-xs leading-relaxed text-faint">
					{m.signup_legal_prefix()}
					<a href={localizeHref('/terms')} class={inlineLinkClass}>{m.signup_legal_terms_link()}</a>
					{m.signup_legal_and()}
					<a href={localizeHref('/privacy')} class={inlineLinkClass}
						>{m.signup_legal_privacy_link()}</a
					>
				</p>

				<button type="submit" disabled={submitting} class={submitButtonClass}>
					{submitting ? m.signup_submitting() : m.signup_submit()}
				</button>
			</form>

			<p class="mt-6 text-sm text-body">
				{m.signup_have_account_prompt()}
				<a
					class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
					href={localizeHref('/login')}>{m.signup_have_account_link()}</a
				>
			</p>
		{/if}
	</div>
</section>
