<script lang="ts">
	// Frosted login modal (#69) — the JS upgrade over the navbar's plain /login link. Rendered ONCE
	// in +layout.svelte; opened from Header.svelte via the shared `loginDialog` rune. The chrome is
	// the shared GlassDialog; the form is the shared LoginForm (the same one the /login page renders),
	// so nothing here can drift from ContactDialog or the login page.
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { loginDialog } from '$lib/login-dialog.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import GlassDialog from './GlassDialog.svelte';
	import LoginForm from './LoginForm.svelte';
</script>

<GlassDialog
	open={loginDialog.open}
	onOpenChange={(open) => (loginDialog.open = open)}
	closeLabel={m.login_close()}
	maxWidth="sm"
>
	<Dialog.Title class="text-2xl font-medium tracking-tight text-white">
		{m.login_heading()}
	</Dialog.Title>
	<Dialog.Description class="mt-2 text-sm text-body">{m.login_lead()}</Dialog.Description>

	<!-- Only mount the form while the dialog is open: Skeleton keeps Dialog.Content in the DOM when
	     closed, so an always-rendered LoginForm would leave a hidden password field on every page
	     (and a duplicate on /login). Mounting on open also gives a fresh form — no lingering password. -->
	{#if loginDialog.open}
		<LoginForm onSuccess={() => loginDialog.close()} />
		<!-- Sign-up prompt — the /login page owns this same chrome (login/+page.svelte). The dialog
		     needs its own copy or JS users have no path to /signup: the navbar "Sign in" opens THIS
		     dialog, not the page, and LoginForm carries only the fields. Close the dialog on click so
		     it can't linger over /signup after client-side navigation. -->
		<p class="mt-6 text-sm text-body">
			{m.login_need_account_prompt()}
			<a
				class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
				href={localizeHref('/signup')}
				onclick={() => loginDialog.close()}>{m.login_need_account_link()}</a
			>
		</p>
		<!-- Forgot-password prompt — same chrome the /login page owns; the dialog needs its own copy
		     (LoginForm carries only the fields). Close the dialog on click so it can't linger over
		     /forgot-password after client-side navigation. -->
		<p class="mt-3 text-sm text-body">
			{m.login_forgot_prompt()}
			<a
				class="font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline"
				href={localizeHref('/forgot-password')}
				onclick={() => loginDialog.close()}>{m.login_forgot_link()}</a
			>
		</p>
	{/if}
</GlassDialog>
