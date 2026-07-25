<script lang="ts">
	// Waitlist v2 step 3 (DAR-62) — commercial context, rendered in the same /waitlist glass-card shell
	// as steps 1–2. Three optional single-selects (current approach, economic impact, realistic budget)
	// plus a capped multi-select (adoption requirement), all individually optional.
	//
	// Only COMMERCIAL/OPERATIONAL use cases get here: the page shows this component when the step-2
	// response routed to 'step3' (waitlist-flow.ts decides, server-side, from the step-2 answers).
	// Researchers, students, investors and anyone who told us nothing route straight past it.
	//
	// Same mechanics as WaitlistStep2: it spreads its own remote form, so with JS it swaps in-place and
	// without JS it degrades to a native per-step POST; the `token` prop (step 1's continuation handle,
	// carried forward by the step-2 response) rides along as a hidden field and is the authorization
	// the server verifies before enriching the row. Continue is FIRST in the DOM so it's the default
	// submitter — pressing Enter continues, it never accidentally skips.
	//
	// The value/budget answers are internal-only: they're never displayed back or emailed to the
	// respondent (DAR-58), so nothing here echoes them into the confirmation.
	import GlassSelect from './GlassSelect.svelte';
	import GlassCheckboxGroup from './GlassCheckboxGroup.svelte';
	import { submitWaitlistStep3 } from '$lib/waitlist-steps.remote';
	import {
		WAITLIST_APPROACHES,
		WAITLIST_IMPACTS,
		WAITLIST_BUDGETS,
		WAITLIST_EVIDENCE,
		WAITLIST_EVIDENCE_MAX
	} from '$lib/waitlist-qualification';
	import { waitlistApproachLabel } from '$lib/waitlist-approach-labels';
	import { waitlistImpactLabel } from '$lib/waitlist-impact-labels';
	import { waitlistBudgetLabel } from '$lib/waitlist-budget-labels';
	import { waitlistEvidenceLabel } from '$lib/waitlist-evidence-labels';
	import { m } from '$lib/paraglide/messages.js';

	let { token }: { token: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const approachOptions = $derived(
		WAITLIST_APPROACHES.map((v) => ({ value: v, label: waitlistApproachLabel[v]() }))
	);
	const impactOptions = $derived(
		WAITLIST_IMPACTS.map((v) => ({ value: v, label: waitlistImpactLabel[v]() }))
	);
	const budgetOptions = $derived(
		WAITLIST_BUDGETS.map((v) => ({ value: v, label: waitlistBudgetLabel[v]() }))
	);
	const evidenceOptions = $derived(
		WAITLIST_EVIDENCE.map((v) => ({ value: v, label: waitlistEvidenceLabel[v]() }))
	);
</script>

<p class="eyebrow text-xs tracking-[0.25em]">{m.waitlist_page_eyebrow()}</p>
<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.waitlist_step3_heading()}</h1>
<p class="mt-2 text-sm text-body">{m.waitlist_step3_lead()}</p>

<!-- Spreading {...submitWaitlistStep3} gives the form its method/action (native POST fallback) plus
     the progressive-enhancement attachment when JS is present. -->
<form class="mt-6 space-y-5" {...submitWaitlistStep3}>
	<!-- The continuation token: authorization the server verifies before enriching the row. Hidden,
	     carried through from the step-2 response (which echoes back what step 1 minted). -->
	<input {...submitWaitlistStep3.fields.token.as('hidden', token)} />

	<GlassSelect
		id="waitlist-approach"
		label={m.waitlist_field_approach_label()}
		help={m.waitlist_field_approach_help()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={approachOptions}
		field={submitWaitlistStep3.fields.currentApproach}
	/>

	<GlassSelect
		id="waitlist-impact"
		label={m.waitlist_field_impact_label()}
		help={m.waitlist_field_impact_help()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={impactOptions}
		field={submitWaitlistStep3.fields.economicImpact}
	/>

	<GlassSelect
		id="waitlist-budget"
		label={m.waitlist_field_budget_label()}
		help={m.waitlist_field_budget_help()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={budgetOptions}
		field={submitWaitlistStep3.fields.budgetRange}
	/>

	<!-- The cap is passed for the disable-at-max hint only; the validator enforces it server-side, and
	     the "Choose up to N" copy reads the same constant, so the number has one source. -->
	<GlassCheckboxGroup
		id="waitlist-evidence"
		legend={m.waitlist_field_evidence_label()}
		help={m.waitlist_field_evidence_help({ max: WAITLIST_EVIDENCE_MAX })}
		badge={m.waitlist_optional()}
		options={evidenceOptions}
		field={submitWaitlistStep3.fields.adoptionEvidence}
		max={WAITLIST_EVIDENCE_MAX}
	/>

	<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
		<!-- Continue is first in the DOM so it's the default submitter (Enter continues); CSS `order`
		     places it on the right on wider screens. -->
		<button
			{...submitWaitlistStep3.fields.intent.as('submit', 'continue')}
			disabled={!!submitWaitlistStep3.pending}
			class="glass-btn order-1 w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-2 sm:w-auto"
		>
			{m.waitlist_flow_continue()}
		</button>
		<button
			{...submitWaitlistStep3.fields.intent.as('submit', 'skip')}
			disabled={!!submitWaitlistStep3.pending}
			class="order-2 rounded-full px-6 py-3 text-sm font-medium text-subtle transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-1"
		>
			{m.waitlist_flow_skip()}
		</button>
	</div>
</form>
