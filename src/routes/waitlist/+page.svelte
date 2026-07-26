<script lang="ts">
	// Public /waitlist page — v2 step 1, the core early-access signup (DAR-60). Same utility-page shell
	// as /contact (CosmicBackdrop + centred glass-card, indexable). It spreads the SAME remote `form`
	// (joinWaitlist), so with JS it progressively enhances and without JS it degrades to a native POST
	// that reloads the page: success arrives as joinWaitlist.result, validation errors + repopulated
	// values come back through the fields' .issues()/.as() during SSR. No custom `enhance` — the
	// default enhancement + native fallback are exactly what this page wants.
	//
	// This is the ONLY required step: submit persists the row immediately (upsertWaitlist), so
	// abandoning the later qualification steps still retains the signup. NAME + EMAIL are required
	// (v1 asked email only); Organization + Country/region + the marketing-consent checkbox are
	// optional. The old `<details>` enrichment disclosure is gone — role moves to step 2, phone to
	// step 4A, and company-size/interest/hear-about left the UI (their columns stay per DAR-59).
	//
	// The success response also carries the DAR-59 continuation token (joinWaitlist.result.token). This
	// page is the step state machine: step-1 success advances to step 2 (DAR-61) rather than straight to
	// the confirmation; a step-2 Continue from a commercial/operational use case advances to step 3
	// (DAR-62), everyone else forks straight to a step-4 branch (DAR-63) — each carrying the token
	// forward as its authorization. Which branch is a SERVER decision the page just obeys. See `stage`.
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import ContactSuccess from '$lib/components/ContactSuccess.svelte';
	import FormPrivacyNotice from '$lib/components/FormPrivacyNotice.svelte';
	import GlassSelect from '$lib/components/GlassSelect.svelte';
	import WaitlistStepHeading from '$lib/components/WaitlistStepHeading.svelte';
	import WaitlistStep2 from '$lib/components/WaitlistStep2.svelte';
	import WaitlistStep3 from '$lib/components/WaitlistStep3.svelte';
	import WaitlistStep4A from '$lib/components/WaitlistStep4A.svelte';
	import WaitlistStep4B from '$lib/components/WaitlistStep4B.svelte';
	import { fieldClass } from '$lib/styles';
	import { joinWaitlist } from '$lib/waitlist.remote';
	import {
		submitWaitlistStep2,
		submitWaitlistStep3,
		submitWaitlistStep4A,
		submitWaitlistStep4B
	} from '$lib/waitlist-steps.remote';
	import { WAITLIST_REGIONS } from '$lib/waitlist-qualification';
	import { toOptions, waitlistRegionLabel } from '$lib/waitlist-labels';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';

	// Slug → {value,label} options for the region select. `$derived` so labels re-resolve on locale
	// change (the label accessors are $state-backed Paraglide messages).
	const regionOptions = $derived(toOptions(WAITLIST_REGIONS, waitlistRegionLabel));

	// Which step to show. Each step endpoint says where the flow goes next (`next`, decided server-side
	// in waitlist-flow.ts — never here), so the page only obeys. LATER results take precedence: on the
	// JS path every earlier result stays truthy, so the order of these fallbacks is load-bearing. The
	// two step-4 branches are mutually exclusive (a sitting only ever reaches one), so their order
	// relative to each other doesn't matter.
	const stage = $derived(
		submitWaitlistStep4A.result?.next ??
			submitWaitlistStep4B.result?.next ??
			submitWaitlistStep3.result?.next ??
			submitWaitlistStep2.result?.next ??
			(joinWaitlist.result?.success ? 'step2' : 'step1')
	);

	// The continuation token for whichever step is showing: step 2 gets step 1's, later steps get the
	// one the previous step's response echoed back (a native no-JS POST re-renders the page, so the
	// step-1 result is gone by then). A misconfigured (secret-less) signup returns none — the steps
	// then can't enrich, but they still render and still terminate cleanly.
	const stepToken = $derived(
		submitWaitlistStep3.result?.token ??
			submitWaitlistStep2.result?.token ??
			joinWaitlist.result?.token ??
			''
	);

	// The signed step-4 branch, minted at step 2 and handed to step 3 so it survives the detour (step 3
	// doesn't re-ask the timeline the fork reads). Opaque here — the page carries it, never reads it.
	const branchClaim = $derived(submitWaitlistStep2.result?.branchClaim ?? '');
</script>

<Seo title={m.waitlist_page_title()} description={m.waitlist_page_description()} />

<CosmicBackdrop />

{#snippet fieldError(issues: { message: string }[] | undefined)}
	{#each issues ?? [] as issue (issue.message)}
		<p class="mt-1.5 text-xs text-error-400">{issue.message}</p>
	{/each}
{/snippet}

<!-- One text field — label (+ optional badge), the glass-field control, and its inline errors.
     `remoteField` is a joinWaitlist.fields.* accessor. `required` marks name + email. -->
{#snippet textField(
	labelText: string,
	remoteField: typeof joinWaitlist.fields.email,
	opts: {
		placeholder: string;
		type?: 'text' | 'email';
		autocomplete?: AutoFill;
		optional?: boolean;
		required?: boolean;
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
			required={opts.required}
		/>
		{@render fieldError(remoteField.issues())}
	</label>
{/snippet}

<section class="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
	<div class="glass-card mx-auto w-full max-w-lg p-6 text-left sm:p-8">
		{#if stage === 'done'}
			<!-- Terminal state: the flow routed to the confirmation (a Skip, or the last step submitted).
			     Value/budget answers are internal-only, so nothing from them is echoed back here. -->
			<ContactSuccess title={m.waitlist_success_title()} body={m.waitlist_success_body()}>
				{#snippet action()}
					<div class="mt-6 flex justify-center">
						<a href={localizeHref('/')} class="glass-btn btn-pill">{m.waitlist_page_back_home()}</a>
					</div>
				{/snippet}
			</ContactSuccess>
		{:else if stage === 'step4a'}
			<!-- Active commercial interest → pilot details (DAR-63 branch A). -->
			<WaitlistStep4A token={stepToken} />
		{:else if stage === 'step4b'}
			<!-- Research or general interest → what they'd like to receive (DAR-63 branch B). -->
			<WaitlistStep4B token={stepToken} />
		{:else if stage === 'step3'}
			<!-- Commercial/operational use case → the optional step-3 questions (DAR-62). -->
			<WaitlistStep3 token={stepToken} {branchClaim} />
		{:else if stage === 'step2'}
			<!-- Step-1 signup succeeded → the optional step-2 questions, authorized by the token step 1
			     returned. -->
			<WaitlistStep2 token={stepToken} />
		{:else}
			<WaitlistStepHeading heading={m.waitlist_heading()} lead={m.waitlist_lead()} />

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

				<!-- Whole-form issues (e.g. rate limit); the name/email field issues render under them. -->
				{#each joinWaitlist.fields.allIssues() as issue (issue.message)}
					{#if issue.path.length === 0}
						<ErrorBanner>{issue.message}</ErrorBanner>
					{/if}
				{/each}

				{@render textField(m.waitlist_field_name_label(), joinWaitlist.fields.name, {
					placeholder: m.waitlist_field_name_placeholder(),
					autocomplete: 'name',
					required: true
				})}

				{@render textField(m.waitlist_field_email_label(), joinWaitlist.fields.email, {
					type: 'email',
					placeholder: m.waitlist_field_email_placeholder(),
					autocomplete: 'email',
					required: true
				})}

				{@render textField(m.waitlist_field_company_label(), joinWaitlist.fields.company, {
					placeholder: m.waitlist_field_company_placeholder(),
					autocomplete: 'organization',
					optional: true
				})}

				<GlassSelect
					id="waitlist-region"
					label={m.waitlist_field_region_label()}
					badge={m.waitlist_optional()}
					placeholder={m.waitlist_select_placeholder()}
					options={regionOptions}
					field={joinWaitlist.fields.countryRegion}
				/>

				<!-- Optional, UNCHECKED marketing opt-in → consent_updates (DAR-59). A checkbox submits
				     nothing when unchecked, so absence is stored as false server-side, never consent. -->
				<label class="flex cursor-pointer items-start gap-3 text-sm text-body">
					<input
						{...joinWaitlist.fields.consentUpdates.as('checkbox')}
						class="mt-0.5 size-4 shrink-0 accent-primary-500"
					/>
					<span>{m.waitlist_consent_label()}</span>
				</label>

				<!-- Data-handling notice (DAR-44) — the shared FormPrivacyNotice, same as the
				     contact form's (ContactFields). -->
				<FormPrivacyNotice
					notice={m.waitlist_privacy_notice()}
					linkLabel={m.waitlist_privacy_link()}
				/>

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
