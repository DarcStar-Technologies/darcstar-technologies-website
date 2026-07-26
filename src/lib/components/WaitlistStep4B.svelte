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
	import { submitWaitlistStep4B } from '$lib/waitlist-steps.remote';
	import { WAITLIST_RESEARCH_PREFERENCES } from '$lib/waitlist-qualification';
	import { waitlistResearchPreferenceLabel } from '$lib/waitlist-research-preference-labels';
	import { m } from '$lib/paraglide/messages.js';

	let { token }: { token: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const preferenceOptions = $derived(
		WAITLIST_RESEARCH_PREFERENCES.map((v) => ({
			value: v,
			label: waitlistResearchPreferenceLabel[v]()
		}))
	);
</script>

<p class="eyebrow text-xs tracking-[0.25em]">{m.waitlist_page_eyebrow()}</p>
<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.waitlist_step4b_heading()}</h1>
<p class="mt-2 text-sm text-body">{m.waitlist_step4b_lead()}</p>

<!-- Spreading {...submitWaitlistStep4B} gives the form its method/action (native POST fallback) plus
     the progressive-enhancement attachment when JS is present. -->
<form class="mt-6 space-y-5" {...submitWaitlistStep4B}>
	<!-- The continuation token: authorization the server verifies before enriching the row. Hidden,
	     carried through from whichever step routed here (step 2 directly, or step 3). -->
	<input {...submitWaitlistStep4B.fields.token.as('hidden', token)} />

	<!-- No `max`: the whole list is selectable (the list length is the natural ceiling, which the
	     validator applies). -->
	<GlassCheckboxGroup
		id="waitlist-prefs"
		legend={m.waitlist_field_prefs_label()}
		badge={m.waitlist_optional()}
		options={preferenceOptions}
		field={submitWaitlistStep4B.fields.researchPreferences}
	/>

	<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
		<!-- Continue is first in the DOM so it's the default submitter (Enter continues); CSS `order`
		     places it on the right on wider screens. -->
		<button
			{...submitWaitlistStep4B.fields.intent.as('submit', 'continue')}
			disabled={!!submitWaitlistStep4B.pending}
			class="glass-btn order-1 w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-2 sm:w-auto"
		>
			{m.waitlist_flow_continue()}
		</button>
		<button
			{...submitWaitlistStep4B.fields.intent.as('submit', 'skip')}
			disabled={!!submitWaitlistStep4B.pending}
			class="order-2 rounded-full px-6 py-3 text-sm font-medium text-subtle transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-1"
		>
			{m.waitlist_flow_skip()}
		</button>
	</div>
</form>
