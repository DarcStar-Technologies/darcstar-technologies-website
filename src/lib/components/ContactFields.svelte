<script module lang="ts">
	// The recessed glass-well styling for the form controls. Exported so the /contact page's
	// native <select> interest control (which this component can't own — see below) can match
	// the fields exactly: `import ContactFields, { fieldClass } from './ContactFields.svelte'`.
	export const fieldClass = 'glass-field w-full rounded-lg px-3.5 py-2.5 text-sm';
	// The pill submit button — shared with the login form (LoginForm) so the two can't drift.
	export const submitButtonClass =
		'glass-btn w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60';
</script>

<script lang="ts">
	// Shared inner body of the contact form — the honeypot, whole-form issues, the
	// name/email/company/message fields, and the submit button — identical between the global
	// modal (ContactDialog) and the standalone /contact page. The PARENT owns the <form>
	// element and its enhancement (the two differ: the modal's keyed `.enhance()` callback vs
	// the page's base `{...submitContact}` no-JS fallback), so this component only renders the
	// controls that go inside it.
	//
	// - `form`   — the remote-form instance to bind fields to (base or a `.for()` key).
	// - `interest` — the "area of interest" control, passed in because it differs per parent
	//   (the modal's JS-only GlassSelect vs the page's no-JS native <select>). Rendered in
	//   the field order, between company and message.
	// - `error`  — optional block rendered just above the submit button (the modal's
	//   catch-all "something went wrong"; the page has none).
	import type { Snippet } from 'svelte';
	import { submitContact } from '$lib/contact.remote';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import ErrorBanner from './ErrorBanner.svelte';
	import FormPrivacyNotice from './FormPrivacyNotice.svelte';

	// `Omit<…, 'for'>` so the prop accepts BOTH the base instance (the /contact page) and a
	// keyed `.for()` instance (the modal) — a keyed instance drops `.for`, and we never call
	// it here anyway (only `.fields` and `.pending`).
	let {
		form,
		interest,
		error
	}: { form: Omit<typeof submitContact, 'for'>; interest: Snippet; error?: Snippet } = $props();
</script>

{#snippet fieldError(issues: { message: string }[] | undefined)}
	{#each issues ?? [] as issue (issue.message)}
		<p class="mt-1.5 text-xs text-error-400">{issue.message}</p>
	{/each}
{/snippet}

<!-- One text/textarea field — label (+ optional badge), the glass-field control, and its
     inline validation errors. `remoteField` is a form.fields.* accessor. -->
{#snippet field(
	labelText: string,
	remoteField: typeof submitContact.fields.name,
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

<!-- Honeypot: off-screen, out of the a11y tree, unfocusable. Humans never fill it; a
     non-empty value is silently dropped server-side. -->
<div class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
	<input {...form.fields.website.as('text')} tabindex="-1" autocomplete="off" aria-hidden="true" />
</div>

<!-- Whole-form issues (e.g. rate limit); field issues render under their field. -->
{#each form.fields.allIssues() as issue (issue.message)}
	{#if issue.path.length === 0}
		<ErrorBanner>{issue.message}</ErrorBanner>
	{/if}
{/each}

{@render field(m.contact_field_name_label(), form.fields.name, {
	placeholder: m.contact_field_name_placeholder(),
	autocomplete: 'name'
})}

{@render field(m.contact_field_email_label(), form.fields.email, {
	type: 'email',
	placeholder: m.contact_field_email_placeholder(),
	autocomplete: 'email'
})}

{@render field(m.contact_field_company_label(), form.fields.company, {
	placeholder: m.contact_field_company_placeholder(),
	autocomplete: 'organization',
	optional: m.contact_field_company_optional()
})}

{@render interest()}

{@render field(m.contact_field_message_label(), form.fields.message, {
	placeholder: m.contact_field_message_placeholder(),
	multiline: true
})}

{@render error?.()}

<!-- Data-handling notice (DAR-44) — lives here so the modal AND the /contact page both carry
     it. Closing the global contact dialog on link click keeps the layout-mounted modal from
     lingering over /privacy after the client-side navigation (the LoginDialog convention); on
     the standalone /contact page the dialog is already closed, so it's a no-op. -->
<FormPrivacyNotice
	notice={m.contact_privacy_notice()}
	linkLabel={m.contact_privacy_link()}
	onLinkClick={() => contactDialog.close()}
/>

<button type="submit" disabled={!!form.pending} class={submitButtonClass}>
	{form.pending ? m.contact_submitting() : m.contact_submit()}
</button>
