<script lang="ts">
	// Frosted login modal (#69) — the JS upgrade over the navbar's plain /login link. Rendered ONCE
	// in +layout.svelte; opened from Header.svelte via the shared `loginDialog` rune. The chrome is
	// the shared GlassDialog; the form is the shared LoginForm (the same one the /login page renders),
	// so nothing here can drift from ContactDialog or the login page.
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { loginDialog } from '$lib/login-dialog.svelte';
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
	{/if}
</GlassDialog>
