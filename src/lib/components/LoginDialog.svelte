<script lang="ts">
	// Frosted login modal (#69) — the JS upgrade over the navbar's plain /login link. Rendered
	// ONCE in +layout.svelte; opened from Header.svelte via the shared `loginDialog` rune. Mirrors
	// ContactDialog's structure; the form itself is the shared LoginForm (the same one the /login
	// page renders), so the dialog and page can't drift.
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import { loginDialog } from '$lib/login-dialog.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import LoginForm from './LoginForm.svelte';
	import Icon from './Icon.svelte';
</script>

<Dialog open={loginDialog.open} onOpenChange={(e) => (loginDialog.open = e.open)}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" />
		<Dialog.Positioner
			class="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4"
		>
			<Dialog.Content
				class="glass-panel relative my-8 w-full max-w-sm rounded-2xl p-6 text-left sm:p-8"
			>
				<Dialog.CloseTrigger
					class="glass-btn absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-body hover:text-white"
					aria-label={m.login_close()}
				>
					<Icon class="size-4">
						<path d="M18 6 6 18M6 6l12 12" />
					</Icon>
				</Dialog.CloseTrigger>

				<Dialog.Title class="text-2xl font-medium tracking-tight text-white">
					{m.login_heading()}
				</Dialog.Title>
				<Dialog.Description class="mt-2 text-sm text-body">{m.login_lead()}</Dialog.Description>

				<!-- Only mount the form while the dialog is open: Skeleton keeps Dialog.Content in the
				     DOM when closed, so an always-rendered LoginForm would leave a hidden password
				     field on every page (and a duplicate on /login). Mounting on open also gives a
				     fresh form each time — no previously-typed password lingering. -->
				{#if loginDialog.open}
					<LoginForm onSuccess={() => loginDialog.close()} />
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
