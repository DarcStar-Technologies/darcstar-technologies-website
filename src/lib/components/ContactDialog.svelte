<script lang="ts">
	// Global contact modal (issue #11). Rendered ONCE in +layout.svelte; opened from
	// the hero/CTA buttons (+page.svelte) and the footer link via the shared
	// `contactDialog` rune. Submits through the `submitContact` remote form → Turso.
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { submitContact } from '$lib/contact.remote';
	import { INTERESTS } from '$lib/contact-interests';
	import { interestLabel } from '$lib/contact-interest-labels';
	import { m } from '$lib/paraglide/messages.js';
	import GlassSelect from './GlassSelect.svelte';
	import ContactFields from './ContactFields.svelte';
	import Icon from './Icon.svelte';

	// This global modal is mounted on EVERY page (via +layout.svelte) — including
	// /contact, which renders its own <form> bound to the same `submitContact` remote
	// singleton. A remote form object can only attach its progressive-enhancement to a
	// single <form>; with two live forms sharing the base instance, one loses enhancement
	// and silently degrades to a native full-page POST. `.for('modal')` gives this dialog
	// an isolated instance so the two coexist. The modal is JS-only, so keying it (rather
	// than the page) keeps the standalone /contact no-JS fallback on the base instance.
	const contactForm = submitContact.for('modal');

	// {value,label} options for the glass dropdown; labels come from the shared interest map
	// (contact-interest-labels.ts). `$derived` so they re-resolve on locale change.
	const interestOptions = $derived(
		INTERESTS.map((value) => ({ value, label: interestLabel[value]() }))
	);

	// Interest uses the custom glass dropdown (GlassSelect) rather than a native
	// <select>, so its value rides a hidden input into the remote form's FormData.
	// Named `interestValue` (not `interest`) so it doesn't collide with the `interest`
	// snippet passed to ContactFields below.
	let interestValue = $state('');
	let showSuccess = $state(false);
	let serverError = $state(false);

	// Skeleton controlled open/close; clear transient state when the dialog closes.
	function handleOpenChange(open: boolean) {
		contactDialog.open = open;
		if (!open) {
			showSuccess = false;
			serverError = false;
		}
	}
</script>

<Dialog open={contactDialog.open} onOpenChange={(e) => handleOpenChange(e.open)}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" />
		<Dialog.Positioner
			class="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4"
		>
			<Dialog.Content
				class="glass-panel relative my-8 w-full max-w-lg rounded-2xl p-6 text-left sm:p-8"
			>
				<Dialog.CloseTrigger
					class="glass-btn absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-body hover:text-white"
					aria-label={m.contact_close()}
				>
					<Icon class="size-4">
						<path d="M18 6 6 18M6 6l12 12" />
					</Icon>
				</Dialog.CloseTrigger>

				{#if showSuccess}
					<div class="py-4 text-center">
						<div
							class="mx-auto flex size-12 items-center justify-center rounded-full bg-success-500/15 text-success-400"
						>
							<Icon class="size-6">
								<path d="M20 6 9 17l-5-5" />
							</Icon>
						</div>
						<Dialog.Title class="mt-4 text-2xl font-medium tracking-tight text-white">
							{m.contact_success_title()}
						</Dialog.Title>
						<Dialog.Description class="mx-auto mt-2 max-w-sm text-sm text-body">
							{m.contact_success_body()}
						</Dialog.Description>
						<Dialog.CloseTrigger class="glass-btn btn-pill mt-6">
							{m.contact_close()}
						</Dialog.CloseTrigger>
					</div>
				{:else}
					<Dialog.Title class="text-2xl font-medium tracking-tight text-white">
						{m.contact_dialog_title()}
					</Dialog.Title>
					<Dialog.Description class="mt-2 text-sm text-body">
						{m.contact_dialog_description()}
					</Dialog.Description>

					<form
						class="mt-6 space-y-4"
						{...contactForm.enhance(async (form) => {
							serverError = false;
							try {
								if (await form.submit()) {
									form.element.reset();
									interestValue = '';
									showSuccess = true;
								}
							} catch {
								serverError = true;
							}
						})}
					>
						<ContactFields form={contactForm}>
							{#snippet interest()}
								<div>
									<GlassSelect
										id="contact-interest"
										label={m.contact_field_interest_label()}
										options={interestOptions}
										placeholder={m.contact_interest_placeholder()}
										bind:value={interestValue}
									/>
									<input type="hidden" name="interest" value={interestValue} />
								</div>
							{/snippet}

							{#snippet error()}
								{#if serverError}
									<p class="text-sm text-error-400" role="alert">{m.contact_error_generic()}</p>
								{/if}
							{/snippet}
						</ContactFields>
					</form>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
