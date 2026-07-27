<script lang="ts">
	// Invite-only notice (DAR-67) — what /signup became when public registration closed. Same
	// standalone utility chrome as /login and /reset-password (centred glass-card, noindex), but it
	// carries no form: the page's whole job is to tell someone who came looking for a sign-up form
	// where to go instead, and to make that somewhere concrete (the waitlist) rather than a shrug.
	//
	// The account-creation boundary is server-side (`disableSignUp`, auth-options.ts). Nothing here
	// enforces anything.
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import { inlineLinkClass, submitButtonClass } from '$lib/styles';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
</script>

<Seo title={m.signup_page_title()} description={m.signup_page_description()} noindex />

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-sm p-6 text-left sm:p-8">
		<p class="eyebrow text-xs tracking-[0.25em]">{m.signup_eyebrow()}</p>
		<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.signup_invite_heading()}</h1>
		<p class="mt-3 text-sm text-body">{m.signup_invite_body()}</p>

		<!-- The waitlist is the only route to an account now, so it gets the primary button rather than
		     a text link. `preload-data="tap"`, not the body-wide `hover` default: /waitlist's load
		     records the funnel's `waitlist_viewed` event (DAR-66), and a hover prefetch runs that load
		     for a page nobody opened — inflating the denominator of the signup conversion rate. -->
		<a
			href={localizeHref('/waitlist')}
			data-sveltekit-preload-data="tap"
			class="{submitButtonClass} mt-6 block text-center">{m.signup_invite_cta()}</a
		>

		<p class="mt-6 text-sm text-body">
			{m.signup_have_account_prompt()}
			<a class={inlineLinkClass} href={localizeHref('/login')}>{m.signup_have_account_link()}</a>
		</p>
	</div>
</section>
