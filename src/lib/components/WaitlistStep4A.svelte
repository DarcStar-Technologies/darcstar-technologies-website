<script lang="ts">
	// Waitlist v2 step 4A (DAR-63) — the ACTIVE COMMERCIAL INTEREST branch of the step-4 fork,
	// rendered in the same /waitlist glass-card shell as steps 1–3. Which branch a visitor sees is
	// decided server-side from their evaluation timeline and carried here as a signed claim (see
	// waitlist-flow.ts) — nothing on this page chooses it.
	//
	// One question is always asked (would you consider a paid evaluation?); the follow-ups — letter of
	// intent, deployment scale, contact permission, preferred method, phone — are REVEALED only for a
	// positive answer, on the same `isPositivePilotInterest` predicate the server gates
	// `contact_permission` and `loi_readiness` on, so the two can't drift.
	//
	// THE REVEAL IS PROGRESSIVE ENHANCEMENT, NOT A GATE. `mounted` is false during SSR and until
	// hydration, so a no-JS visitor gets every field rendered (all optional, as the spec asks) and can
	// submit them; JS only collapses what isn't relevant. Data is never gated on the client — the
	// validator decides what gets stored either way, and it treats a not-shown contact permission as
	// "never asked" (null) rather than a decline.
	import { onMount } from 'svelte';
	import GlassSelect from './GlassSelect.svelte';
	import WaitlistStepActions from './WaitlistStepActions.svelte';
	import WaitlistStepHeading from './WaitlistStepHeading.svelte';
	import { fieldClass, fieldLabelClass, fieldHelpClass } from '$lib/styles';
	import { submitWaitlistStep4A } from '$lib/waitlist-steps.remote';
	import {
		WAITLIST_PILOT_INTERESTS,
		WAITLIST_LOI_READINESS,
		WAITLIST_CONTACT_METHODS,
		WAITLIST_DEPLOYMENT_SCALE_MAX,
		isPositivePilotInterest
	} from '$lib/waitlist-qualification';
	import {
		toOptions,
		waitlistPilotInterestLabel,
		waitlistLoiReadinessLabel,
		waitlistContactMethodLabel
	} from '$lib/waitlist-labels';
	import { m } from '$lib/paraglide/messages.js';

	// `flowClaim` carries step 2's signed decisions. This is the terminal step, so what it needs from
	// them is the CTA audience the confirmation is personalized on (DAR-64) — passed straight through
	// as a hidden field, never read here.
	let { token, flowClaim, flowId }: { token: string; flowClaim: string; flowId: string } = $props();

	// Slug → {value,label} options. `$derived` so labels re-resolve on locale change (the label
	// accessors are $state-backed Paraglide messages).
	const pilotOptions = $derived(toOptions(WAITLIST_PILOT_INTERESTS, waitlistPilotInterestLabel));
	const loiOptions = $derived(toOptions(WAITLIST_LOI_READINESS, waitlistLoiReadinessLabel));
	const contactMethodOptions = $derived(
		toOptions(WAITLIST_CONTACT_METHODS, waitlistContactMethodLabel)
	);

	// The two selects' live values drive the reveals, so they're bound rather than read through
	// `field.value()` — once hydrated GlassSelect's glass menu writes a hidden input, which fires no
	// input event for the remote form's field state to observe.
	let pilotInterest = $state('');
	let contactMethod = $state('');

	// False on the server and until hydration → everything renders for a no-JS visitor.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	const showContactBlock = $derived(!mounted || isPositivePilotInterest(pilotInterest));
	const showPhone = $derived(!mounted || contactMethod === 'phone-video');
</script>

<WaitlistStepHeading heading={m.waitlist_step4a_heading()} lead={m.waitlist_step4a_lead()} />

<!-- Spreading {...submitWaitlistStep4A} gives the form its method/action (native POST fallback) plus
     the progressive-enhancement attachment when JS is present. -->
<form class="mt-6 space-y-5" {...submitWaitlistStep4A}>
	<!-- The continuation token: authorization the server verifies before enriching the row. Hidden,
	     carried through from whichever step routed here (step 3, or step 2 directly). -->
	<input {...submitWaitlistStep4A.fields.token.as('hidden', token)} />
	<input {...submitWaitlistStep4A.fields.flowClaim.as('hidden', flowClaim)} />

	<!-- The funnel handle (DAR-66): anonymous, authorizes nothing, and never reaches the signup row —
	     it only ties this submit to the same analytics flow the page view started. -->
	<input {...submitWaitlistStep4A.fields.flowId.as('hidden', flowId)} />

	<GlassSelect
		id="waitlist-pilot"
		label={m.waitlist_field_pilot_label()}
		help={m.waitlist_field_pilot_help()}
		badge={m.waitlist_optional()}
		placeholder={m.waitlist_select_placeholder()}
		options={pilotOptions}
		field={submitWaitlistStep4A.fields.pilotInterest}
		bind:value={pilotInterest}
	/>

	{#if showContactBlock}
		<div class="space-y-5">
			<!-- DAR-112. First in the block because it is the second half of the question above it — the
			     rest (scale, permission, method, phone) is logistics — so someone who stops partway has
			     still answered the one that matters most for triage. A TAG, NOT AN LOI: the help text says
			     the letter would be nonbinding AND that answering commits them to nothing, and the server
			     nulls this whenever the pilot answer isn't positive. -->
			<GlassSelect
				id="waitlist-loi"
				label={m.waitlist_field_loi_label()}
				help={m.waitlist_field_loi_help()}
				badge={m.waitlist_optional()}
				placeholder={m.waitlist_select_placeholder()}
				options={loiOptions}
				field={submitWaitlistStep4A.fields.loiReadiness}
			/>

			<div>
				<label for="waitlist-scale" class={fieldLabelClass}>
					{m.waitlist_field_scale_label()}
					<span class="font-normal text-faint">{m.waitlist_optional()}</span>
				</label>
				<p id="waitlist-scale-help" class={fieldHelpClass}>{m.waitlist_field_scale_help()}</p>
				<!-- maxlength is the browser-side courtesy; the validator truncates to the same constant. -->
				<textarea
					{...submitWaitlistStep4A.fields.deploymentScale.as('text')}
					id="waitlist-scale"
					aria-describedby="waitlist-scale-help"
					rows="3"
					maxlength={WAITLIST_DEPLOYMENT_SCALE_MAX}
					placeholder={m.waitlist_field_scale_placeholder()}
					class="{fieldClass} min-h-20 resize-y"></textarea>
			</div>

			<!-- Tri-state on the server: this box is only meaningful while the pilot answer is positive,
			     so a submit without it recorded as "never asked", never as a revoked grant. -->
			<label class="flex cursor-pointer items-start gap-3 text-sm text-body">
				<input
					{...submitWaitlistStep4A.fields.contactPermission.as('checkbox')}
					class="mt-0.5 size-4 shrink-0 accent-primary-500"
				/>
				<span>{m.waitlist_contact_permission_label()}</span>
			</label>

			<GlassSelect
				id="waitlist-contact-method"
				label={m.waitlist_field_contact_method_label()}
				badge={m.waitlist_optional()}
				placeholder={m.waitlist_select_placeholder()}
				options={contactMethodOptions}
				field={submitWaitlistStep4A.fields.contactMethod}
				bind:value={contactMethod}
			/>

			{#if showPhone}
				<div>
					<label for="waitlist-phone" class={fieldLabelClass}>
						{m.waitlist_field_phone_label()}
						<span class="font-normal text-faint">{m.waitlist_optional()}</span>
					</label>
					<input
						{...submitWaitlistStep4A.fields.phone.as('tel')}
						id="waitlist-phone"
						autocomplete="tel"
						placeholder={m.waitlist_field_phone_placeholder()}
						class={fieldClass}
					/>
				</div>
			{/if}
		</div>
	{/if}

	<WaitlistStepActions form={submitWaitlistStep4A} />
</form>
