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
	// the server verifies before enriching the row.
	//
	// The value/budget answers are internal-only: they're never displayed back or emailed to the
	// respondent (DAR-58), so nothing here echoes them into the confirmation.
	import GlassSelect from './GlassSelect.svelte';
	import WaitlistStepActions from './WaitlistStepActions.svelte';
	import WaitlistStepHeading from './WaitlistStepHeading.svelte';
	import GlassCheckboxGroup from './GlassCheckboxGroup.svelte';
	import { submitWaitlistStep3 } from '$lib/waitlist-steps.remote';
	import {
		WAITLIST_APPROACHES,
		WAITLIST_IMPACTS,
		WAITLIST_BUDGETS,
		WAITLIST_EVIDENCE,
		WAITLIST_EVIDENCE_MAX
	} from '$lib/waitlist-qualification';
	import {
		toOptions,
		waitlistApproachLabel,
		waitlistImpactLabel,
		waitlistBudgetLabel,
		waitlistEvidenceLabel
	} from '$lib/waitlist-labels';
	import { m } from '$lib/paraglide/messages.js';

	// `branchClaim` is step 2's SIGNED step-4 branch, passed straight through as a hidden field. Step 3
	// doesn't re-ask the evaluation timeline the fork reads, so the decision rides along rather than
	// being re-derived — and it's signed, so editing this field can't opt anyone into branch A (see
	// waitlist-flow.ts' mintWaitlistBranchClaim).
	let { token, branchClaim }: { token: string; branchClaim: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const approachOptions = $derived(toOptions(WAITLIST_APPROACHES, waitlistApproachLabel));
	const impactOptions = $derived(toOptions(WAITLIST_IMPACTS, waitlistImpactLabel));
	const budgetOptions = $derived(toOptions(WAITLIST_BUDGETS, waitlistBudgetLabel));
	const evidenceOptions = $derived(toOptions(WAITLIST_EVIDENCE, waitlistEvidenceLabel));
</script>

<WaitlistStepHeading heading={m.waitlist_step3_heading()} lead={m.waitlist_step3_lead()} />

<!-- Spreading {...submitWaitlistStep3} gives the form its method/action (native POST fallback) plus
     the progressive-enhancement attachment when JS is present. -->
<form class="mt-6 space-y-5" {...submitWaitlistStep3}>
	<!-- The continuation token: authorization the server verifies before enriching the row. Hidden,
	     carried through from the step-2 response (which echoes back what step 1 minted). -->
	<input {...submitWaitlistStep3.fields.token.as('hidden', token)} />
	<input {...submitWaitlistStep3.fields.branchClaim.as('hidden', branchClaim)} />

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

	<WaitlistStepActions form={submitWaitlistStep3} />
</form>
