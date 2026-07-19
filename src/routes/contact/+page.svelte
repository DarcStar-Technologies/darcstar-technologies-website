<script lang="ts">
	// Standalone /contact page (issue #55) — a shareable, no-JS fallback for the global
	// contact modal (ContactDialog.svelte). It spreads the SAME remote `form`
	// (submitContact), so with JS it progressively enhances and without JS it degrades
	// to a native POST that reloads the page: success then arrives as
	// submitContact.result, and validation errors + repopulated values come back
	// through the fields' .issues()/.as() during SSR. No custom `enhance` — the default
	// enhancement + native fallback are exactly what a fallback page wants.
	//
	// The interest picker is a NATIVE <select> here (the modal's GlassSelect is a
	// JS-only Zag component, so it can't be the no-JS control); the shared glass-field
	// utility already styles a native select to match (layout.css).
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import { submitContact } from '$lib/contact.remote';
	import { INTERESTS } from '$lib/contact-interests';
	import { interestLabel } from '$lib/contact-interest-labels';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';

	// Same recessed glass wells as the modal; consumers add only sizing.
	const fieldClass = 'glass-field w-full rounded-lg px-3.5 py-2.5 text-sm';
</script>

{#snippet fieldError(issues: { message: string }[] | undefined)}
	{#each issues ?? [] as issue (issue.message)}
		<p class="mt-1.5 text-xs text-error-400">{issue.message}</p>
	{/each}
{/snippet}

<!-- One text/textarea field — label (+ optional badge), the glass-field control, and its
     inline validation errors. `remoteField` is a submitContact.fields.* accessor. -->
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

<Seo title={m.contact_page_title()} description={m.contact_page_description()} />

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-panel mx-auto w-full max-w-lg rounded-2xl p-6 text-left sm:p-8">
		{#if submitContact.result?.success}
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
				<h1 class="mt-4 text-2xl font-medium tracking-tight text-white">
					{m.contact_success_title()}
				</h1>
				<p class="mx-auto mt-2 max-w-sm text-sm text-body">
					{m.contact_success_body()}
				</p>
				<div class="mt-6 flex justify-center">
					<a href={localizeHref('/')} class="glass-btn btn-pill">{m.contact_page_back_home()}</a>
				</div>
			</div>
		{:else}
			<p class="eyebrow text-xs tracking-[0.25em]">{m.contact_page_eyebrow()}</p>
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">
				{m.contact_dialog_title()}
			</h1>
			<p class="mt-2 text-sm text-body">{m.contact_dialog_description()}</p>

			<!-- Spreading {...submitContact} gives the form its method/action (native POST
			     fallback) plus the progressive-enhancement attachment when JS is present. -->
			<form class="mt-6 space-y-4" {...submitContact}>
				<!-- Honeypot: off-screen, out of the a11y tree, unfocusable. Humans never
				     fill it; a non-empty value is silently dropped server-side. -->
				<div
					class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden"
					aria-hidden="true"
				>
					<input
						{...submitContact.fields.website.as('text')}
						tabindex="-1"
						autocomplete="off"
						aria-hidden="true"
					/>
				</div>

				<!-- Whole-form issues (e.g. rate limit); field issues render under their field. -->
				{#each submitContact.fields.allIssues() as issue (issue.message)}
					{#if issue.path.length === 0}
						<p
							class="rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-400"
							role="alert"
						>
							{issue.message}
						</p>
					{/if}
				{/each}

				{@render field(m.contact_field_name_label(), submitContact.fields.name, {
					placeholder: m.contact_field_name_placeholder(),
					autocomplete: 'name'
				})}

				{@render field(m.contact_field_email_label(), submitContact.fields.email, {
					type: 'email',
					placeholder: m.contact_field_email_placeholder(),
					autocomplete: 'email'
				})}

				{@render field(m.contact_field_company_label(), submitContact.fields.company, {
					placeholder: m.contact_field_company_placeholder(),
					autocomplete: 'organization',
					optional: m.contact_field_company_optional()
				})}

				<label class="block">
					<span
						class="mb-1.5 flex items-baseline gap-2 text-xs font-medium tracking-wide text-body"
					>
						{m.contact_field_interest_label()}
					</span>
					<!-- The dropdown chevron is a CSS-only affordance (`select.glass-field` in
					     layout.css) so it renders without JS, matching the modal's GlassSelect. -->
					<select {...submitContact.fields.interest.as('select')} class={fieldClass}>
						<option value="">{m.contact_interest_placeholder()}</option>
						{#each INTERESTS as value (value)}
							<option {value}>{interestLabel[value]()}</option>
						{/each}
					</select>
				</label>

				{@render field(m.contact_field_message_label(), submitContact.fields.message, {
					placeholder: m.contact_field_message_placeholder(),
					multiline: true
				})}

				<button
					type="submit"
					disabled={!!submitContact.pending}
					class="glass-btn w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
				>
					{submitContact.pending ? m.contact_submitting() : m.contact_submit()}
				</button>
			</form>
		{/if}
	</div>
</section>
