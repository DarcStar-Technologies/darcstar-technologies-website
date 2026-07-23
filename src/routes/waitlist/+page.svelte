<script lang="ts">
	// Public /waitlist page — early-access lead capture. Same utility-page shell as /contact
	// (CosmicBackdrop + centred glass-card, indexable). It spreads the SAME remote `form`
	// (joinWaitlist), so with JS it progressively enhances and without JS it degrades to a native POST
	// that reloads the page: success arrives as joinWaitlist.result, validation errors + repopulated
	// values come back through the fields' .issues()/.as() during SSR. No custom `enhance` — the
	// default enhancement + native fallback are exactly what this page wants.
	//
	// "Not too annoying" = progressive disclosure: only EMAIL (required) and the submit button show up
	// front; every enrichment field lives inside a <details> "add details (optional)" (a no-JS-friendly
	// disclosure). `interest` is free text with a <datalist> of suggestions (seed + values other people
	// have entered often enough to be non-identifying — see +page.server.ts), never a closed enum.
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import ContactSuccess from '$lib/components/ContactSuccess.svelte';
	import { fieldClass } from '$lib/components/ContactFields.svelte';
	import { joinWaitlist } from '$lib/waitlist.remote';
	import { WAITLIST_ROLES } from '$lib/waitlist-roles';
	import { waitlistRoleLabel } from '$lib/waitlist-role-labels';
	import { WAITLIST_COMPANY_SIZES } from '$lib/waitlist-company-sizes';
	import { waitlistCompanySizeLabel } from '$lib/waitlist-company-size-labels';
	import { WAITLIST_REFERRAL_SOURCES } from '$lib/waitlist-referral-sources';
	import { waitlistReferralLabel } from '$lib/waitlist-referral-labels';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Slug → {value,label} option lists for the selects. `$derived` so labels re-resolve on locale
	// change (the label accessors are $state-backed Paraglide messages).
	const roleOptions = $derived(
		WAITLIST_ROLES.map((v) => ({ value: v, label: waitlistRoleLabel[v]() }))
	);
	const sizeOptions = $derived(
		WAITLIST_COMPANY_SIZES.map((v) => ({ value: v, label: waitlistCompanySizeLabel[v]() }))
	);
	const hearOptions = $derived(
		WAITLIST_REFERRAL_SOURCES.map((v) => ({ value: v, label: waitlistReferralLabel[v]() }))
	);

	const interestListId = 'waitlist-interest-opts';
</script>

<Seo title={m.waitlist_page_title()} description={m.waitlist_page_description()} />

<CosmicBackdrop />

{#snippet fieldError(issues: { message: string }[] | undefined)}
	{#each issues ?? [] as issue (issue.message)}
		<p class="mt-1.5 text-xs text-error-400">{issue.message}</p>
	{/each}
{/snippet}

<!-- One text field — label (+ optional badge), the glass-field control, and its inline errors.
     `remoteField` is a joinWaitlist.fields.* accessor. `list` wires the interest input to its
     <datalist>; `required` marks email. -->
{#snippet textField(
	labelText: string,
	remoteField: typeof joinWaitlist.fields.email,
	opts: {
		placeholder: string;
		type?: 'text' | 'email';
		autocomplete?: AutoFill;
		optional?: boolean;
		required?: boolean;
		list?: string;
	}
)}
	<label class="block">
		<span class="mb-1.5 flex items-baseline gap-2 text-xs font-medium tracking-wide text-body">
			{labelText}
			{#if opts.optional}<span class="font-normal text-faint">{m.waitlist_optional()}</span>{/if}
		</span>
		<input
			{...remoteField.as(opts.type ?? 'text')}
			class={fieldClass}
			placeholder={opts.placeholder}
			autocomplete={opts.autocomplete}
			list={opts.list}
			required={opts.required}
		/>
		{@render fieldError(remoteField.issues())}
	</label>
{/snippet}

<!-- One optional <select>, styled to match the glass fields (the CSS chevron affordance in
     layout.css renders without JS). Empty first option = "not selected". -->
{#snippet selectField(
	labelText: string,
	remoteField: typeof joinWaitlist.fields.role,
	options: { value: string; label: string }[]
)}
	<label class="block">
		<span class="mb-1.5 flex items-baseline gap-2 text-xs font-medium tracking-wide text-body">
			{labelText}
			<span class="font-normal text-faint">{m.waitlist_optional()}</span>
		</span>
		<select {...remoteField.as('select')} class={fieldClass}>
			<option value="">{m.waitlist_select_placeholder()}</option>
			{#each options as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</label>
{/snippet}

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-lg p-6 text-left sm:p-8">
		{#if joinWaitlist.result?.success}
			<ContactSuccess title={m.waitlist_success_title()} body={m.waitlist_success_body()}>
				{#snippet action()}
					<div class="mt-6 flex justify-center">
						<a href={localizeHref('/')} class="glass-btn btn-pill">{m.waitlist_page_back_home()}</a>
					</div>
				{/snippet}
			</ContactSuccess>
		{:else}
			<p class="eyebrow text-xs tracking-[0.25em]">{m.waitlist_page_eyebrow()}</p>
			<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.waitlist_heading()}</h1>
			<p class="mt-2 text-sm text-body">{m.waitlist_lead()}</p>

			<!-- Spreading {...joinWaitlist} gives the form its method/action (native POST fallback) plus
			     the progressive-enhancement attachment when JS is present. -->
			<form class="mt-6 space-y-4" {...joinWaitlist}>
				<!-- Honeypot: off-screen, out of the a11y tree, unfocusable. A non-empty value is
				     silently dropped server-side. -->
				<div
					class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden"
					aria-hidden="true"
				>
					<input
						{...joinWaitlist.fields.website.as('text')}
						tabindex="-1"
						autocomplete="off"
						aria-hidden="true"
					/>
				</div>

				<!-- Whole-form issues (e.g. rate limit); the email field's issues render under it. -->
				{#each joinWaitlist.fields.allIssues() as issue (issue.message)}
					{#if issue.path.length === 0}
						<ErrorBanner>{issue.message}</ErrorBanner>
					{/if}
				{/each}

				{@render textField(m.waitlist_field_email_label(), joinWaitlist.fields.email, {
					type: 'email',
					placeholder: m.waitlist_field_email_placeholder(),
					autocomplete: 'email',
					required: true
				})}

				<!-- Progressive disclosure: everything below is optional lead enrichment, tucked away so
				     the default view is just email + the button. Native <details> works without JS. -->
				<details class="group rounded-lg border border-hairline/60 px-3.5 py-3">
					<summary
						class="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-body transition-colors [&::-webkit-details-marker]:hidden hover:text-white"
					>
						{m.waitlist_details_summary()}
						<span class="text-faint transition-transform group-open:rotate-180" aria-hidden="true"
							>▾</span
						>
					</summary>
					<div class="mt-4 space-y-4">
						{@render textField(m.waitlist_field_name_label(), joinWaitlist.fields.name, {
							placeholder: m.waitlist_field_name_placeholder(),
							autocomplete: 'name',
							optional: true
						})}
						{@render textField(m.waitlist_field_company_label(), joinWaitlist.fields.company, {
							placeholder: m.waitlist_field_company_placeholder(),
							autocomplete: 'organization',
							optional: true
						})}
						{@render selectField(
							m.waitlist_field_role_label(),
							joinWaitlist.fields.role,
							roleOptions
						)}
						{@render selectField(
							m.waitlist_field_company_size_label(),
							joinWaitlist.fields.companySize,
							sizeOptions
						)}
						{@render textField(m.waitlist_field_interest_label(), joinWaitlist.fields.interest, {
							placeholder: m.waitlist_field_interest_placeholder(),
							optional: true,
							list: interestListId
						})}
						<datalist id={interestListId}>
							{#each data.interestSuggestions as suggestion (suggestion)}
								<option value={suggestion}></option>
							{/each}
						</datalist>
						{@render selectField(
							m.waitlist_field_hear_about_label(),
							joinWaitlist.fields.hearAbout,
							hearOptions
						)}
						{@render textField(m.waitlist_field_phone_label(), joinWaitlist.fields.phone, {
							placeholder: m.waitlist_field_phone_placeholder(),
							autocomplete: 'tel',
							optional: true
						})}
					</div>
				</details>

				<button
					type="submit"
					disabled={!!joinWaitlist.pending}
					class="glass-btn w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
				>
					{joinWaitlist.pending ? m.waitlist_submitting() : m.waitlist_submit()}
				</button>
			</form>
		{/if}
	</div>
</section>
