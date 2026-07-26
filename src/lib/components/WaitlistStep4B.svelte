<script lang="ts">
	// Waitlist v2 step 4B (DAR-63) — the RESEARCH / GENERAL INTEREST branch of the step-4 fork. One
	// uncapped multi-select: what this person would like us to send them.
	//
	// Branch B deliberately asks nothing about budgets, pilots or contact permission, and it's the
	// FAIL-SAFE side of the fork: an unanswered, unrecognized or tampered timeline lands here rather
	// than in branch A's contact-collection (waitlist-flow.ts).
	//
	// These preferences are NOT consent to be mailed — `consent_updates` (step 1) governs that, and it
	// is itself an unverified single-opt-in claim. Picking "technical reports" says what someone would
	// want if we write to them, not that we may.
	import GlassCheckboxGroup from './GlassCheckboxGroup.svelte';
	import WaitlistStepActions from './WaitlistStepActions.svelte';
	import WaitlistStepHeading from './WaitlistStepHeading.svelte';
	import { submitWaitlistStep4B } from '$lib/waitlist-steps.remote';
	import { WAITLIST_RESEARCH_PREFERENCES } from '$lib/waitlist-qualification';
	import { toOptions, waitlistResearchPreferenceLabel } from '$lib/waitlist-labels';
	import { m } from '$lib/paraglide/messages.js';

	// `flowClaim` carries step 2's signed decisions. This is the terminal step, so what it needs from
	// them is the CTA audience the confirmation is personalized on (DAR-64) — passed straight through
	// as a hidden field, never read here.
	let { token, flowClaim }: { token: string; flowClaim: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const preferenceOptions = $derived(
		toOptions(WAITLIST_RESEARCH_PREFERENCES, waitlistResearchPreferenceLabel)
	);
</script>

<WaitlistStepHeading heading={m.waitlist_step4b_heading()} lead={m.waitlist_step4b_lead()} />

<!-- Spreading {...submitWaitlistStep4B} gives the form its method/action (native POST fallback) plus
     the progressive-enhancement attachment when JS is present. -->
<form class="mt-6 space-y-5" {...submitWaitlistStep4B}>
	<!-- The continuation token: authorization the server verifies before enriching the row. Hidden,
	     carried through from whichever step routed here (step 2 directly, or step 3). -->
	<input {...submitWaitlistStep4B.fields.token.as('hidden', token)} />
	<input {...submitWaitlistStep4B.fields.flowClaim.as('hidden', flowClaim)} />

	<!-- No `max`: the whole list is selectable (the list length is the natural ceiling, which the
	     validator applies). -->
	<GlassCheckboxGroup
		id="waitlist-prefs"
		legend={m.waitlist_field_prefs_label()}
		badge={m.waitlist_optional()}
		options={preferenceOptions}
		field={submitWaitlistStep4B.fields.researchPreferences}
	/>

	<WaitlistStepActions form={submitWaitlistStep4B} />
</form>
