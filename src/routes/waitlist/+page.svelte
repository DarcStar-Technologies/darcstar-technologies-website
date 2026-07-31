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
	// forward as its authorization. Which branch is a SERVER decision the page just obeys, and so is
	// the confirmation's CTA (DAR-64). See `stage` and `cta`.
	import Seo from '$lib/components/Seo.svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import FormPrivacyNotice from '$lib/components/FormPrivacyNotice.svelte';
	import GlassSelect from '$lib/components/GlassSelect.svelte';
	import WaitlistStepHeading from '$lib/components/WaitlistStepHeading.svelte';
	import WaitlistStep2 from '$lib/components/WaitlistStep2.svelte';
	import WaitlistStep3 from '$lib/components/WaitlistStep3.svelte';
	import WaitlistStep4A from '$lib/components/WaitlistStep4A.svelte';
	import WaitlistStep4B from '$lib/components/WaitlistStep4B.svelte';
	import WaitlistConfirmation from '$lib/components/WaitlistConfirmation.svelte';
	import {
		checkboxClass,
		fieldBadgeClass,
		fieldClass,
		fieldHelpClass,
		fieldLabelClass,
		mutedLinkClass,
		submitButtonClass
	} from '$lib/styles';
	import { joinWaitlist, restartWaitlist } from '$lib/waitlist.remote';
	import {
		submitWaitlistStep2,
		submitWaitlistStep3,
		submitWaitlistStep4A,
		submitWaitlistStep4B
	} from '$lib/waitlist-steps.remote';
	import { WAITLIST_REGIONS } from '$lib/waitlist-qualification';
	import { toOptions, waitlistRegionLabel } from '$lib/waitlist-labels';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageData } from './$types';

	// The page's server data: the funnel's anonymous flow id (DAR-66) and, when this browser has a
	// waitlist-resume cookie, the step it left off at with the signed values that step needs (DAR-75).
	let { data }: { data: PageData } = $props();

	// Slug → {value,label} options for the region select. `$derived` so labels re-resolve on locale
	// change (the label accessors are $state-backed Paraglide messages).
	const regionOptions = $derived(toOptions(WAITLIST_REGIONS, waitlistRegionLabel));

	// Which step this REQUEST routed to, or undefined when no form ran — i.e. a plain page view. Each
	// step endpoint says where the flow goes next (`next`, decided server-side in waitlist-flow.ts —
	// never here), so the page only obeys. LATER results take precedence: on the JS path every earlier
	// result stays truthy, so the order of these fallbacks is load-bearing. The two step-4 branches
	// are mutually exclusive (a sitting only ever reaches one), so their order relative to each other
	// doesn't matter.
	const resultStage = $derived(
		submitWaitlistStep4A.result?.next ??
			submitWaitlistStep4B.result?.next ??
			submitWaitlistStep3.result?.next ??
			submitWaitlistStep2.result?.next ??
			(joinWaitlist.result?.success ? 'step2' : undefined)
	);

	// Which step to SHOW. A live result always wins over the cookie: on a no-JS submit the page is
	// re-rendered by the POST, and its load reads the cookie the very same request just wrote, so the
	// two agree — but the result is the authority and the cookie is the memory of it.
	const stage = $derived(resultStage ?? data.resume?.stage ?? 'step1');

	// True only when the COOKIE put the visitor here — a reload or a fresh arrival mid-flow, never a
	// submit. It gates the "start a new signup" link: on the terminal screen that link would otherwise
	// be a second call to action, which is exactly what DAR-64's confirmation is built not to have.
	const resumed = $derived(resultStage === undefined && data.resume != null);

	// The continuation token for whichever step is showing: step 2 gets step 1's, later steps get the
	// one the previous step's response echoed back (a native no-JS POST re-renders the page, so the
	// step-1 result is gone by then), and a resumed visitor gets one freshly minted for their own row
	// by the load. A misconfigured (secret-less) signup returns none — the steps then can't enrich,
	// but they still render and still terminate cleanly.
	const stepToken = $derived(
		submitWaitlistStep3.result?.token ??
			submitWaitlistStep2.result?.token ??
			joinWaitlist.result?.token ??
			data.resume?.token ??
			''
	);

	// Step 2's signed decisions — the step-4 branch and the confirmation's CTA audience — minted at
	// step 2 and echoed by step 3 so they survive the detour (neither step re-asks the answers they
	// were derived from). Opaque here: the page carries the claim to the next step, never reads it.
	// On a resumed render the load re-mints it from the same pair, which the cookie carried.
	const flowClaim = $derived(
		submitWaitlistStep3.result?.flowClaim ??
			submitWaitlistStep2.result?.flowClaim ??
			data.resume?.flowClaim ??
			''
	);

	// The funnel handle (DAR-66) for whichever step is showing. `data.flowId` is the one this render's
	// load minted and recorded the view under; every step echoes back what it was given, so the whole
	// funnel stays one flow even on the no-JS path, where each POST re-renders the page and its load
	// mints a fresh handle this chain then ignores. Opaque to the page: it is signed (DAR-86), and
	// nothing here reads or produces one.
	//
	// `||`, not `??`: an echo is `''` when the submitted value wasn't a string at all (and the load
	// hands back `''` on a deploy with no signing secret), and that must fall through rather than pin
	// the page to an empty handle.
	const flowId = $derived(
		submitWaitlistStep4A.result?.flowId ||
			submitWaitlistStep4B.result?.flowId ||
			submitWaitlistStep3.result?.flowId ||
			submitWaitlistStep2.result?.flowId ||
			joinWaitlist.result?.flowId ||
			data.flowId
	);

	// The confirmation's one call to action (DAR-64), decided server-side by whichever step ended the
	// flow — only a terminal response carries one, so the same later-wins fallback chain as `stage`
	// finds it. `'home'` is the fail-safe default (it commits to nothing) for the shapes that can't
	// happen: no result at all, or a response that predates this field.
	const cta = $derived(
		submitWaitlistStep4A.result?.cta ??
			submitWaitlistStep4B.result?.cta ??
			submitWaitlistStep3.result?.cta ??
			submitWaitlistStep2.result?.cta ??
			data.resume?.cta ??
			'home'
	);
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
		<span class={fieldLabelClass}>
			{labelText}
			{#if opts.optional}<span class={fieldBadgeClass}>{m.waitlist_optional()}</span>{/if}
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
			<WaitlistConfirmation {cta} {flowId} />
		{:else if stage === 'step4a'}
			<!-- Active commercial interest → pilot details (DAR-63 branch A). -->
			<WaitlistStep4A token={stepToken} {flowClaim} {flowId} />
		{:else if stage === 'step4b'}
			<!-- Research or general interest → what they'd like to receive (DAR-63 branch B). -->
			<WaitlistStep4B token={stepToken} {flowClaim} {flowId} />
		{:else if stage === 'step3'}
			<!-- Commercial/operational use case → the optional step-3 questions (DAR-62). -->
			<WaitlistStep3 token={stepToken} {flowClaim} {flowId} />
		{:else if stage === 'step2'}
			<!-- Step-1 signup succeeded → the optional step-2 questions, authorized by the token step 1
			     returned. -->
			<WaitlistStep2 token={stepToken} {flowId} />
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

				<!-- The funnel handle (DAR-66) this render's view was recorded under, so the signup can be
				     attributed to the same flow. Anonymous, and signed (DAR-86) so that only a real page
				     load can produce one — see $lib/server/waitlist-funnel.ts. -->
				<input {...joinWaitlist.fields.flowId.as('hidden', flowId)} />

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
				     nothing when unchecked, so absence is stored as false server-side, never consent.
				     The label is unchanged by DAR-139 and the help line is the whole change: what was
				     untrue here was never the wording of the request, it was that ticking it had an
				     undisclosed consequence. It now sends one confirmation email, so the form has to say
				     so before it happens — and the sentence is also the honest description of the gate,
				     since nothing is sent unless that email is answered. -->
				<label class="flex cursor-pointer items-start gap-3 text-sm text-body">
					<input {...joinWaitlist.fields.consentUpdates.as('checkbox')} class={checkboxClass} />
					<span>{m.waitlist_consent_label()}</span>
				</label>
				<!-- `-mt-2 ps-7` rather than the bare help class: this one sits BELOW its control instead of
				     above a field, and the padding lines it up with the label text rather than with the
				     checkbox, so it reads as part of the tick box and not as more form-level fine print
				     next to the privacy notice underneath. (7 = the checkbox's `size-4` plus the label's
				     `gap-3`.) -->
				<p class="{fieldHelpClass} -mt-2 ps-7">{m.waitlist_consent_help()}</p>

				<!-- Data-handling notice (DAR-44) — the shared FormPrivacyNotice, same as the
				     contact form's (ContactFields). -->
				<FormPrivacyNotice
					notice={m.waitlist_privacy_notice()}
					linkLabel={m.waitlist_privacy_link()}
				/>

				<button type="submit" disabled={!!joinWaitlist.pending} class={submitButtonClass}>
					{joinWaitlist.pending ? m.waitlist_submitting() : m.waitlist_submit()}
				</button>
			</form>
		{/if}
	</div>

	{#if resumed}
		<!-- The escape hatch for a resumed render (DAR-75). Without it, a visitor who finished the flow
		     and came back to sign a colleague up would meet the confirmation and no form at all — a
		     worse dead end than the blank-form bug this feature fixes.

		     Deliberately OUTSIDE the card, and only when the cookie is what put them here.

		     A FORM, NOT A LINK. Clearing the resume cookie is a state mutation, so it belongs behind a
		     POST — and a destructive GET behind an internal link is a trap in a Kit app: <body> sets
		     `preload-data="hover"`, so preloading the data ran the load and dropped the cookie on
		     mouse-over, with no click. A POST is never prefetched, so nothing can fire it by accident.
		     It also keeps DAR-64's one-CTA confirmation literally true — a submit button isn't a
		     second link on that screen. Reasoning lives with `restartWaitlist`. -->
		<form {...restartWaitlist} class="mt-5 text-center">
			<button type="submit" class="{mutedLinkClass} cursor-pointer"
				>{m.waitlist_restart_link()}</button
			>
		</form>
	{/if}
</section>
