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
	// The shared inner form body (honeypot, fields, submit) — same as the modal's. This page
	// only supplies its own <form> wrapper (for the no-JS native POST) and the interest
	// control (a native <select>, since the modal's GlassSelect is JS-only). `fieldClass` is
	// re-exported so that <select> matches the fields exactly.
	import ContactFields, { fieldClass } from '$lib/components/ContactFields.svelte';
	import IconCheck from '$lib/components/IconCheck.svelte';
</script>

<Seo title={m.contact_page_title()} description={m.contact_page_description()} />

<CosmicBackdrop />

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-panel mx-auto w-full max-w-lg rounded-2xl p-6 text-left sm:p-8">
		{#if submitContact.result?.success}
			<div class="py-4 text-center">
				<div
					class="mx-auto flex size-12 items-center justify-center rounded-full bg-success-500/15 text-success-400"
				>
					<IconCheck class="size-6" />
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
				<ContactFields form={submitContact}>
					{#snippet interest()}
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
					{/snippet}
				</ContactFields>
			</form>
		{/if}
	</div>
</section>
