<script lang="ts">
	// Waitlist v2 step 2 (DAR-61) — the first optional qualification step, rendered inside the same
	// /waitlist glass-card shell after a successful step-1 signup. Three single-select questions
	// (primary application, role, evaluation timeline), all individually optional. It spreads the
	// `submitWaitlistStep2` remote form, so with JS it swaps in-place and without JS it degrades to a
	// native per-step POST. The `token` prop (step 1's continuation handle) rides along as a hidden
	// field — it's the authorization the server verifies before enriching the row.
	//
	// The page owns the step state machine (it shows this component while step 1 has succeeded but step
	// 2 hasn't); this component owns only the form. Both submit buttons post the same form: Continue
	// writes the answers, "Skip for now" persists nothing. Continue is FIRST in the DOM so it's the
	// default submitter — pressing Enter continues, it never accidentally skips.
	import GlassSelect from './GlassSelect.svelte';
	import { submitWaitlistStep2 } from '$lib/waitlist-steps.remote';
	import {
		WAITLIST_APPLICATIONS,
		WAITLIST_V2_ROLES,
		WAITLIST_TIMELINES
	} from '$lib/waitlist-qualification';
	import { waitlistApplicationLabel } from '$lib/waitlist-application-labels';
	import { waitlistV2RoleLabel } from '$lib/waitlist-v2-role-labels';
	import { waitlistTimelineLabel } from '$lib/waitlist-timeline-labels';
	import { m } from '$lib/paraglide/messages.js';

	let { token }: { token: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const applicationOptions = $derived(
		WAITLIST_APPLICATIONS.map((v) => ({ value: v, label: waitlistApplicationLabel[v]() }))
	);
	const roleOptions = $derived(
		WAITLIST_V2_ROLES.map((v) => ({ value: v, label: waitlistV2RoleLabel[v]() }))
	);
	const timelineOptions = $derived(
		WAITLIST_TIMELINES.map((v) => ({ value: v, label: waitlistTimelineLabel[v]() }))
	);
</script>

<p class="eyebrow text-xs tracking-[0.25em]">{m.waitlist_page_eyebrow()}</p>
<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{m.waitlist_step2_heading()}</h1>
<p class="mt-2 text-sm text-body">{m.waitlist_step2_lead()}</p>

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

	<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
		<!-- Continue is first in the DOM so it's the default submitter (Enter continues); CSS `order`
		     places it on the right on wider screens. -->
		<button
			{...submitWaitlistStep2.fields.intent.as('submit', 'continue')}
			disabled={!!submitWaitlistStep2.pending}
			class="glass-btn order-1 w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-2 sm:w-auto"
		>
			{m.waitlist_step2_continue()}
		</button>
		<button
			{...submitWaitlistStep2.fields.intent.as('submit', 'skip')}
			disabled={!!submitWaitlistStep2.pending}
			class="order-2 rounded-full px-6 py-3 text-sm font-medium text-subtle transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-1"
		>
			{m.waitlist_step2_skip()}
		</button>
	</div>
</form>
