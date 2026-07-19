<script lang="ts">
	// Global contact modal (issue #11). Rendered ONCE in +layout.svelte; opened from
	// the hero/CTA buttons (+page.svelte) and the footer link via the shared
	// `contactDialog` rune. Submits through the `submitContact` remote form → Turso.
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { submitContact } from '$lib/contact.remote';
	import { INTERESTS, type Interest } from '$lib/contact-interests';
	import { m } from '$lib/paraglide/messages.js';
	import GlassSelect from './GlassSelect.svelte';

	// This global modal is mounted on EVERY page (via +layout.svelte) — including
	// /contact, which renders its own <form> bound to the same `submitContact` remote
	// singleton. A remote form object can only attach its progressive-enhancement to a
	// single <form>; with two live forms sharing the base instance, one loses enhancement
	// and silently degrades to a native full-page POST. `.for('modal')` gives this dialog
	// an isolated instance so the two coexist. The modal is JS-only, so keying it (rather
	// than the page) keeps the standalone /contact no-JS fallback on the base instance.
	const contactForm = submitContact.for('modal');

	// slug → localized label, single-sourced from INTERESTS (order follows the array).
	const interestLabel: Record<Interest, () => string> = {
		robotics: m.contact_interest_robotics,
		markets: m.contact_interest_markets,
		'formal-methods': m.contact_interest_formal_methods,
		partnership: m.contact_interest_partnership,
		other: m.contact_interest_other
	};
	const interestOptions = $derived(
		INTERESTS.map((value) => ({ value, label: interestLabel[value]() }))
	);

	// Interest uses the custom glass dropdown (GlassSelect) rather than a native
	// <select>, so its value rides a hidden input into the remote form's FormData.
	let interest = $state('');
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

	// Recessed, beveled, grainy fields carved into the glass panel — the look lives in
	// the `glass-field` utility (layout.css); consumers add only sizing.
	const fieldClass = 'glass-field w-full rounded-lg px-3.5 py-2.5 text-sm';
</script>

{#snippet fieldError(issues: { message: string }[] | undefined)}
	{#each issues ?? [] as issue (issue.message)}
		<p class="mt-1.5 text-xs text-error-400">{issue.message}</p>
	{/each}
{/snippet}

<!-- One text/textarea field — label (+ optional badge), the glass-field control, and its
     inline validation errors. `remoteField` is a contactForm.fields.* accessor. -->
{#snippet field(
	labelText: string,
	remoteField: typeof contactForm.fields.name,
	opts: {
		placeholder: string;
		type?: 'text' | 'email';
		autocomplete?: AutoFill;
		optional?: string;
		multiline?: boolean;
	}
)}
	<label class="block">
		<span class="mb-1.5 flex items-baseline gap-2 text-xs font-medium tracking-wide text-body">
			{labelText}
			{#if opts.optional}<span class="font-normal text-faint">{opts.optional}</span>{/if}
		</span>
		{#if opts.multiline}
			<textarea
				{...remoteField.as('text')}
				rows="4"
				class="{fieldClass} min-h-28 resize-y"
				placeholder={opts.placeholder}></textarea>
		{:else}
			<input
				{...remoteField.as(opts.type ?? 'text')}
				class={fieldClass}
				placeholder={opts.placeholder}
				autocomplete={opts.autocomplete}
			/>
		{/if}
		{@render fieldError(remoteField.issues())}
	</label>
{/snippet}

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
					<svg
						class="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</Dialog.CloseTrigger>

				{#if showSuccess}
					<div class="py-4 text-center">
						<div
							class="mx-auto flex size-12 items-center justify-center rounded-full bg-success-500/15 text-success-400"
						>
							<svg
								class="size-6"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M20 6 9 17l-5-5" />
							</svg>
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
									interest = '';
									showSuccess = true;
								}
							} catch {
								serverError = true;
							}
						})}
					>
						<!-- Honeypot: off-screen, out of the a11y tree, unfocusable. Humans never
						     fill it; a non-empty value is silently dropped server-side. -->
						<div
							class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden"
							aria-hidden="true"
						>
							<input
								{...contactForm.fields.website.as('text')}
								tabindex="-1"
								autocomplete="off"
								aria-hidden="true"
							/>
						</div>

						<!-- Whole-form issues (e.g. rate limit); field issues render under their field. -->
						{#each contactForm.fields.allIssues() as issue (issue.message)}
							{#if issue.path.length === 0}
								<p
									class="rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-400"
									role="alert"
								>
									{issue.message}
								</p>
							{/if}
						{/each}

						{@render field(m.contact_field_name_label(), contactForm.fields.name, {
							placeholder: m.contact_field_name_placeholder(),
							autocomplete: 'name'
						})}

						{@render field(m.contact_field_email_label(), contactForm.fields.email, {
							type: 'email',
							placeholder: m.contact_field_email_placeholder(),
							autocomplete: 'email'
						})}

						{@render field(m.contact_field_company_label(), contactForm.fields.company, {
							placeholder: m.contact_field_company_placeholder(),
							autocomplete: 'organization',
							optional: m.contact_field_company_optional()
						})}

						<div>
							<GlassSelect
								id="contact-interest"
								label={m.contact_field_interest_label()}
								options={interestOptions}
								placeholder={m.contact_interest_placeholder()}
								bind:value={interest}
							/>
							<input type="hidden" name="interest" value={interest} />
						</div>

						{@render field(m.contact_field_message_label(), contactForm.fields.message, {
							placeholder: m.contact_field_message_placeholder(),
							multiline: true
						})}

						{#if serverError}
							<p class="text-sm text-error-400" role="alert">{m.contact_error_generic()}</p>
						{/if}

						<button
							type="submit"
							disabled={!!contactForm.pending}
							class="glass-btn w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
						>
							{contactForm.pending ? m.contact_submitting() : m.contact_submit()}
						</button>
					</form>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
