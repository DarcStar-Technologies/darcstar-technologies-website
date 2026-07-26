<script lang="ts">
	// Waitlist v2 step 2 (DAR-61) — the first optional qualification step, rendered inside the same
	// /waitlist glass-card shell after a successful step-1 signup. Three single-select questions
	// (primary application, role, evaluation timeline), all individually optional. It spreads the
	// `submitWaitlistStep2` remote form, so with JS it swaps in-place and without JS it degrades to a
	// native per-step POST. The `token` prop (step 1's continuation handle) rides along as a hidden
	// field — it's the authorization the server verifies before enriching the row.
	//
	// The page owns the step state machine (it shows this component while step 1 has succeeded but step
	// 2 hasn't); this component owns only the form. The Continue / "Skip for now" pair is
	// WaitlistStepActions, shared with every other step.
	import GlassSelect from './GlassSelect.svelte';
	import WaitlistStepActions from './WaitlistStepActions.svelte';
	import WaitlistStepHeading from './WaitlistStepHeading.svelte';
	import { submitWaitlistStep2 } from '$lib/waitlist-steps.remote';
	import {
		WAITLIST_APPLICATIONS,
		WAITLIST_V2_ROLES,
		WAITLIST_TIMELINES
	} from '$lib/waitlist-qualification';
	import {
		toOptions,
		waitlistApplicationLabel,
		waitlistV2RoleLabel,
		waitlistTimelineLabel
	} from '$lib/waitlist-labels';
	import { m } from '$lib/paraglide/messages.js';

	let { token }: { token: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const applicationOptions = $derived(toOptions(WAITLIST_APPLICATIONS, waitlistApplicationLabel));
	const roleOptions = $derived(toOptions(WAITLIST_V2_ROLES, waitlistV2RoleLabel));
	const timelineOptions = $derived(toOptions(WAITLIST_TIMELINES, waitlistTimelineLabel));
</script>

<WaitlistStepHeading heading={m.waitlist_step2_heading()} lead={m.waitlist_step2_lead()} />

<!-- Spreading {...submitWaitlistStep2} gives the form its method/action (native POST fallback) plus
     the progressive-enhancement attachment when JS is present. -->
<form class="mt-6 space-y-4" {...submitWaitlistStep2}>
	<!-- The continuation token: authorization the server verifies before enriching the row. Hidden,
	     carried straight through from step 1's success response. -->
	<input {...submitWaitlistStep2.fields.token.as('hidden', token)} />

	<GlassSelect
		id="waitlist-application"
		label={m.waitlist_field_application_label()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={applicationOptions}
		field={submitWaitlistStep2.fields.primaryApplication}
	/>

	<GlassSelect
		id="waitlist-role"
		label={m.waitlist_field_role_label()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={roleOptions}
		field={submitWaitlistStep2.fields.role}
	/>

	<GlassSelect
		id="waitlist-timeline"
		label={m.waitlist_field_timeline_label()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={timelineOptions}
		field={submitWaitlistStep2.fields.evaluationTimeline}
	/>

	<WaitlistStepActions form={submitWaitlistStep2} />
</form>
