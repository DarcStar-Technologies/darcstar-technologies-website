<script lang="ts">
	// Standalone login page (#69) — the no-JS fallback the navbar "Sign in" link points at,
	// and a shareable URL. Utility-page layout (a centred glass-panel), matching /contact. The form
	// is the shared LoginForm (the same one the navbar's LoginDialog renders) — a real form action,
	// so it works without JS; `form` carries the action result back for the no-JS re-render.
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import LoginForm from '$lib/components/LoginForm.svelte';
	import { inlineLinkClass } from '$lib/styles';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<Seo title={m.login_page_title()} description={m.login_page_description()} noindex />

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-sm p-6 text-left sm:p-8">
		<p class="eyebrow text-xs tracking-[0.25em]">{m.login_eyebrow()}</p>
		<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.login_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.login_lead()}</p>
		<LoginForm {form} />
		<!-- DAR-67: points at /waitlist, not /signup. Accounts are invite-only, so /signup is now just a
		     notice saying so — sending someone there first would be one click of nothing before the
		     place they actually need to go. `preload-data="tap"` because /waitlist's load records the
		     funnel's `waitlist_viewed` event (DAR-66) and a hover prefetch would count a phantom view. -->
		<p class="mt-6 text-sm text-body">
			{m.login_need_account_prompt()}
			<a class={inlineLinkClass} href={localizeHref('/waitlist')} data-sveltekit-preload-data="tap"
				>{m.login_need_account_link()}</a
			>
		</p>
		<p class="mt-3 text-sm text-body">
			{m.login_forgot_prompt()}
			<a class={inlineLinkClass} href={localizeHref('/forgot-password')}>{m.login_forgot_link()}</a>
		</p>
	</div>
</section>
