<script lang="ts">
	// Standalone admin login page (#69) — the no-JS fallback the navbar "Sign in" link points at,
	// and a shareable URL. Utility-page layout (a centred glass-panel), matching /contact. The form
	// is the shared LoginForm (the same one the navbar's LoginDialog renders) — a real form action,
	// so it works without JS; `form` carries the action result back for the no-JS re-render.
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import LoginForm from '$lib/components/LoginForm.svelte';
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
	</div>
</section>
