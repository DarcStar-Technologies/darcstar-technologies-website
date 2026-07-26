<script lang="ts">
	// Gated admin view of waitlist signups — sibling of the contact-submissions triage view. Reached
	// only past the /admin route guard (../+layout.server.ts). Same frosted-glass aesthetic.
	//
	// DAR-65 turned it from a flat log into a triage surface: every row carries its internal lead
	// class (decided server-side by `classifyWaitlistLead`, never here), rows sort priority-first, the
	// chips filter by class through a plain GET so it all works without JS, and each row opens a
	// <details> with the full v2 qualification answers. Slug columns map to their localized labels;
	// free text (interest, deployment scale) is shown verbatim.
	import Seo from '$lib/components/Seo.svelte';
	import WaitlistLeadClassBadge from '$lib/components/WaitlistLeadClassBadge.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import {
		waitlistRoleLabel,
		waitlistV2RoleLabel,
		waitlistCompanySizeLabel,
		waitlistReferralLabel,
		waitlistRegionLabel,
		waitlistApplicationLabel,
		waitlistTimelineLabel,
		waitlistApproachLabel,
		waitlistImpactLabel,
		waitlistBudgetLabel,
		waitlistEvidenceLabel,
		waitlistPilotInterestLabel,
		waitlistContactMethodLabel,
		waitlistResearchPreferenceLabel,
		waitlistLeadClassLabel,
		waitlistFunnelEventLabel
	} from '$lib/waitlist-labels';
	import { WAITLIST_LEAD_CLASSES } from '$lib/waitlist-qualification';
	import { WAITLIST_FUNNEL_EVENTS } from '$lib/waitlist-funnel';
	import { isWaitlistResend } from '$lib/waitlist-invite';
	import type { WaitlistRole } from '$lib/waitlist-roles';
	import type { WaitlistV2Role } from '$lib/waitlist-qualification';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const DASH = '—';

	// Slug → localized label, falling back to the raw value for a legacy/unknown slug and to an
	// em-dash when the question was never answered. Deliberately keyed on plain strings: these are
	// nullable free-text columns at the DB layer, so a stored value may predate (or post-date) the
	// label map, and a triage view should show whatever is actually in the row rather than blank.
	type SlugLabels = Record<string, () => string>;
	const labelled = (value: string | null, labels: SlugLabels): string =>
		value ? (labels[value]?.() ?? value) : DASH;
	// `Array.isArray`, not a truthiness check: the two multi-selects are `mode: 'json'` columns whose
	// `$type<string[]>()` is an assertion, not a validation. A row holding valid-but-not-array JSON
	// would otherwise throw inside .map() and take the WHOLE triage page down over one bad row.
	const labelledList = (values: string[] | null, labels: SlugLabels): string =>
		Array.isArray(values) && values.length > 0
			? values.map((v) => labels[v]?.() ?? v).join(', ')
			: DASH;
	const orDash = (v: string | number | null): string => (v === null ? DASH : String(v));

	// `role` holds BOTH the v1 slug set (legacy rows) and the v2 set (DAR-61's step 2 writes the same
	// column), so resolve it against both label maps — v2 first — before the raw-slug fallback.
	const roleFor = (v: string | null) =>
		v
			? (waitlistV2RoleLabel[v as WaitlistV2Role]?.() ??
				waitlistRoleLabel[v as WaitlistRole]?.() ??
				v)
			: DASH;

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const atCap = $derived(data.total >= data.limit);

	// Funnel readout (DAR-66). The rate is decided server-side (`signupConversionRate`); this only
	// formats it. A null rate — nothing viewed yet, so no denominator — renders as the same em-dash
	// every unanswered value on this page uses, rather than a "0%" that would read as "nobody
	// converts" instead of "nothing measured".
	const countFmt = new Intl.NumberFormat('en-US');
	const rateFmt = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
	const conversionLabel = $derived(
		data.conversion === null ? DASH : rateFmt.format(data.conversion)
	);

	const basePath = $derived(localizeHref('/admin/waitlist'));
	// SvelteKit reads the action name from the `?/name` key, so extra params ride alongside it.
	const deleteAction = $derived(data.filter ? `?/delete&class=${data.filter}` : '?/delete');
	const inviteAction = $derived(data.filter ? `?/invite&class=${data.filter}` : '?/invite');

	// Invite outcome (DAR-67). `form` is a union across both actions, so narrow on the namespace key
	// rather than on `ok`/`error` — a delete result carries those too.
	const invite = $derived(form && 'invite' in form ? form.invite : null);
	// The action's return is a discriminated union of one success and several failures; `in` is what
	// narrows it, since `fail()` and the success shape share no key.
	const inviteOk = $derived(invite && 'ok' in invite ? invite : null);
	const inviteError = $derived(invite && 'error' in invite ? invite.error : null);
	function inviteErrorMessage(code: string): string {
		switch (code) {
			case 'staff_account':
				return m.admin_waitlist_invite_error_staff();
			// The account exists but nothing was mailed, so the row is still un-invited and the button
			// still reads Invite. Worth its own message: "try again" is genuinely the right next move,
			// unlike the generic failure where something may be structurally wrong.
			case 'email_failed':
			case 'email_unconfigured':
				return m.admin_waitlist_invite_error_email();
			default:
				return m.admin_waitlist_invite_error();
		}
	}
	const chipBase =
		'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500';
	const chipActive = 'bg-white/10 text-white';
	const chipIdle = 'text-faint hover:text-white';
</script>

<Seo
	title={m.admin_waitlist_page_title()}
	description={m.admin_waitlist_page_description()}
	noindex
/>

<!-- One label/value pair in a row's qualification detail. -->
{#snippet detail(label: string, value: string)}
	<div>
		<dt class="text-xs tracking-wide text-faint">{label}</dt>
		<dd class="text-sm break-words text-body">{value}</dd>
	</div>
{/snippet}

<section class="space-y-8">
	<header>
		<h1 class="text-3xl font-medium tracking-tight text-white">{m.admin_waitlist_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.admin_waitlist_lead()}</p>
	</header>

	{#if form && 'error' in form}
		<p class="text-sm text-error-400" role="alert">{m.admin_delete_error()}</p>
	{/if}

	<!-- Invite outcome (DAR-67). Both branches sit at the top of the page rather than in the row: a
	     no-JS submit re-renders the whole table, and hunting for a status message inside 200 rows is
	     not a confirmation. Success names the address so the operator can see they hit the row they
	     meant to. -->
	{#if inviteOk}
		<p class="text-sm text-success-400" role="status">
			{m.admin_waitlist_invite_sent({ email: inviteOk.email })}
		</p>
	{:else if inviteError}
		<p class="text-sm text-error-400" role="alert">{inviteErrorMessage(inviteError)}</p>
	{/if}

	<!-- Funnel readout (DAR-66). Distinct anonymous flows per stage, in funnel order, so the drop-off
	     reads top-to-bottom — these rows are an events table with no link to any signup below, which
	     is why a count can sit on the same page as the leads without being a profile of anyone. The
	     caveat under it is load-bearing: bots inflate the view count and the last stage needs JS, so
	     this is directional, not a source of record. -->
	<section class="glass-card p-4 sm:p-6" aria-labelledby="waitlist-funnel-heading">
		<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<h2 id="waitlist-funnel-heading" class="text-sm font-medium text-white">
				{m.admin_waitlist_funnel_heading()}
			</h2>
			<p class="text-sm">
				<span class="text-faint">{m.admin_waitlist_funnel_conversion()}</span>
				<span class="ml-2 font-medium text-emphasis tabular-nums">{conversionLabel}</span>
			</p>
		</div>

		{#if data.funnel}
			<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
				{#each WAITLIST_FUNNEL_EVENTS as event (event)}
					<div>
						<dt class="text-xs tracking-wide text-faint">{waitlistFunnelEventLabel[event]()}</dt>
						<dd class="text-lg text-white tabular-nums">{countFmt.format(data.funnel[event])}</dd>
					</div>
				{/each}
			</dl>

			<p class="mt-4 text-xs text-faint">{m.admin_waitlist_funnel_note()}</p>
		{:else}
			<!-- The aggregate failed (a deploy ahead of its migration, a DB blip). Say so rather than
			     render a funnel of zeros, which would read as "nobody has ever visited" — and the leads
			     below stay on screen either way, which is the point of the load catching it. -->
			<p class="mt-4 text-sm text-faint">{m.admin_waitlist_funnel_unavailable()}</p>
		{/if}
	</section>

	<!-- Filter by lead class. Plain links + a GET query, so it needs no JS and every view is
	     bookmarkable; the counts are over the whole window, not the filtered slice.
	     aria-current="true" rather than "page": this IS still the waitlist page, and the layout's
	     nav already owns the one aria-current="page" — two of those would leave a screen reader
	     announcing two different "current page"s. -->
	<nav class="flex flex-wrap items-center gap-1" aria-label={m.admin_waitlist_filter_label()}>
		<a
			href={basePath}
			aria-current={data.filter === null ? 'true' : undefined}
			class="{chipBase} {data.filter === null ? chipActive : chipIdle}"
			>{m.admin_waitlist_filter_option({
				label: m.admin_waitlist_filter_all(),
				count: data.total
			})}</a
		>
		{#each WAITLIST_LEAD_CLASSES as leadClass (leadClass)}
			<a
				href={`${basePath}?class=${leadClass}`}
				aria-current={data.filter === leadClass ? 'true' : undefined}
				class="{chipBase} {data.filter === leadClass ? chipActive : chipIdle}"
				>{m.admin_waitlist_filter_option({
					label: waitlistLeadClassLabel[leadClass](),
					count: data.counts[leadClass]
				})}</a
			>
		{/each}
		<!-- The window note lives WITH the chips, not in the table header, because the counts are
		     windowed too: "Priority A (0)" means none in the most recent slice, not none on the list.
		     Keeping it here also means a filtered-to-empty view still discloses the window, which it
		     wouldn't if the note only rendered alongside a populated table. -->
		{#if atCap}
			<span class="ml-1 text-xs text-faint">{m.admin_cap_note({ limit: data.limit })}</span>
		{/if}
	</nav>

	<div class="glass-card p-4 sm:p-6">
		{#if data.total === 0}
			<p class="px-2 py-12 text-center text-sm text-faint">{m.admin_waitlist_empty()}</p>
		{:else if data.signups.length === 0}
			<p class="px-2 py-12 text-center text-sm text-faint">{m.admin_waitlist_filter_empty()}</p>
		{:else}
			<p class="px-2 pb-4 text-sm text-emphasis">
				{m.admin_waitlist_count({ count: data.signups.length })}
			</p>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-hairline text-xs tracking-wide text-faint">
							<th class="px-3 py-2 font-medium whitespace-nowrap">{m.admin_waitlist_col_class()}</th
							>
							<th class="px-3 py-2 font-medium whitespace-nowrap">{m.admin_col_received()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_email()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_name()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_company()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_role()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_outreach()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_access()}</th>
							<th class="px-3 py-2 text-right font-medium">
								<span class="sr-only">{m.admin_col_actions()}</span>
							</th>
						</tr>
					</thead>
					<!-- One <tbody> per signup: the summary row and its detail row belong together, and
					     grouping lets the divider fall between signups instead of inside one. -->
					{#each data.signups as row (row.id)}
						<!-- One named rule for "is this a repeat invitation", shared with the server side
						     ($lib/waitlist-invite.ts) rather than re-derived per label below. -->
						{@const resend = isWaitlistResend(row.inviteState)}
						<tbody class="border-b border-hairline">
							<tr class="align-top">
								<td class="px-3 py-3"><WaitlistLeadClassBadge leadClass={row.leadClass} /></td>
								<td class="px-3 py-3 whitespace-nowrap text-faint">{fmt.format(row.createdAt)}</td>
								<td class="px-3 py-3">
									<a
										href={`mailto:${row.email}`}
										class="text-body transition-colors hover:text-primary-500">{row.email}</a
									>
								</td>
								<td class="px-3 py-3 text-emphasis">{orDash(row.name)}</td>
								<td class="px-3 py-3 text-body">{orDash(row.company)}</td>
								<td class="px-3 py-3 whitespace-nowrap text-body">{roleFor(row.role)}</td>
								<td class="px-3 py-3 whitespace-nowrap">
									<!-- Tri-state: null = never asked (the pilot answer wasn't positive), false =
									     asked and declined, true = granted. A grant is the one worth spotting. -->
									{#if row.contactPermission === true}
										<span
											class="inline-flex items-center rounded-full bg-success-500/15 px-2 py-0.5 text-xs font-medium text-success-300"
											>{m.admin_waitlist_outreach_granted()}</span
										>
									{:else if row.contactPermission === false}
										<span class="text-xs text-body">{m.admin_waitlist_outreach_declined()}</span>
									{:else}
										<span class="text-xs text-faint">{m.admin_waitlist_outreach_unasked()}</span>
									{/if}
								</td>
								<td class="px-3 py-3 whitespace-nowrap">
									<!-- Invite state (DAR-67), derived server-side from invited_at/activated_at. Three
									     states, and only the last is self-evidently good news: "invited" means an email
									     went out, not that anyone acted on it. -->
									{#if row.inviteState === 'activated'}
										<span
											class="inline-flex items-center rounded-full bg-success-500/15 px-2 py-0.5 text-xs font-medium text-success-300"
											>{m.admin_waitlist_invite_activated()}</span
										>
									{:else if row.inviteState === 'invited'}
										<span
											class="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-body"
											>{m.admin_waitlist_invite_invited()}</span
										>
									{:else}
										<span class="text-xs text-faint">{m.admin_waitlist_invite_not_invited()}</span>
									{/if}
								</td>
								<td class="px-3 py-3 text-right align-top">
									<!-- Invite / resend. Same two-step <details> confirm as delete below, and for the
									     same reason rather than for symmetry: one click here puts a real email in a
									     prospect's inbox. A row that has already been invited says "Resend" — DAR-67
									     requires a re-invite to be an explicit act, never an accidental duplicate. -->
									<details class="mb-1.5 inline-block text-right">
										<summary
											class="inline-flex cursor-pointer list-none items-center rounded px-2 py-1 text-xs font-medium text-primary-500 transition-colors [&::-webkit-details-marker]:hidden hover:bg-primary-500/10 focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:outline-none"
											>{resend
												? m.admin_waitlist_invite_resend()
												: m.admin_waitlist_invite()}</summary
										>
										<form method="post" action={inviteAction} class="mt-1.5">
											<input type="hidden" name="id" value={row.id} />
											<button
												type="submit"
												class="rounded bg-primary-500/20 px-2 py-1 text-xs font-medium text-primary-200 transition-colors hover:bg-primary-500/30 focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:outline-none"
												aria-label={resend
													? m.admin_waitlist_invite_resend_sr({ email: row.email })
													: m.admin_waitlist_invite_sr({ email: row.email })}
												>{resend
													? m.admin_waitlist_invite_resend_confirm()
													: m.admin_waitlist_invite_confirm()}</button
											>
										</form>
									</details>

									<!-- Two-step confirm, no JS: the <summary> reveals the delete button; clicking it
									     again cancels. Avoids a one-click misclick without needing confirm(). -->
									<details class="inline-block text-right">
										<summary
											class="inline-flex cursor-pointer list-none items-center rounded px-2 py-1 text-xs font-medium text-error-400 transition-colors [&::-webkit-details-marker]:hidden hover:bg-error-500/10 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
											>{m.admin_delete()}</summary
										>
										<!-- Carry the active filter through the action URL. A bare `?/delete` would
									     resolve to /admin/waitlist?/delete and drop `class=`, bouncing the
									     operator out of the band they were working. -->
										<form method="post" action={deleteAction} class="mt-1.5">
											<input type="hidden" name="id" value={row.id} />
											<button
												type="submit"
												class="rounded bg-error-500/20 px-2 py-1 text-xs font-medium text-error-200 transition-colors hover:bg-error-500/30 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
												aria-label={m.admin_waitlist_delete_sr({ email: row.email })}
												>{m.admin_delete_confirm()}</button
											>
										</form>
									</details>
								</td>
							</tr>
							<tr>
								<td colspan="9" class="px-3 pb-3">
									<details>
										<summary
											aria-label={m.admin_waitlist_detail_sr({ email: row.email })}
											class="inline-flex cursor-pointer items-center rounded text-xs text-faint transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:outline-none"
											>{m.admin_waitlist_detail_show()}</summary
										>
										<dl class="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
											{@render detail(
												m.admin_waitlist_field_region(),
												labelled(row.countryRegion, waitlistRegionLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_application(),
												labelled(row.primaryApplication, waitlistApplicationLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_timeline(),
												labelled(row.evaluationTimeline, waitlistTimelineLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_approach(),
												labelled(row.currentApproach, waitlistApproachLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_impact(),
												labelled(row.economicImpact, waitlistImpactLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_budget(),
												labelled(row.budgetRange, waitlistBudgetLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_evidence(),
												labelledList(row.adoptionEvidence, waitlistEvidenceLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_pilot(),
												labelled(row.pilotInterest, waitlistPilotInterestLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_deployment(),
												orDash(row.deploymentScale)
											)}
											{@render detail(
												m.admin_waitlist_field_contact_method(),
												labelled(row.contactMethod, waitlistContactMethodLabel)
											)}
											{@render detail(m.admin_waitlist_col_phone(), orDash(row.phone))}
											{@render detail(
												m.admin_waitlist_field_research_prefs(),
												labelledList(row.researchPreferences, waitlistResearchPreferenceLabel)
											)}
											{@render detail(
												m.admin_waitlist_field_consent(),
												row.consentUpdates
													? m.admin_waitlist_consent_yes()
													: m.admin_waitlist_consent_no()
											)}
											{@render detail(m.admin_waitlist_field_step(), orDash(row.qualificationStep))}
											{@render detail(m.admin_waitlist_field_updated(), fmt.format(row.updatedAt))}
											<!-- Invite audit (DAR-67). `invited_at` is the LAST send, not the first — a
											     resend overwrites it — so the durable history is the per-invite Workers
											     Logs line, not this. `invited_by` is a staff user id: the roster is a
											     different query, and resolving a name per row would cost one. -->
											{@render detail(
												m.admin_waitlist_field_invited(),
												row.invitedAt ? fmt.format(row.invitedAt) : DASH
											)}
											{@render detail(m.admin_waitlist_field_invited_by(), orDash(row.invitedBy))}
											{@render detail(
												m.admin_waitlist_field_activated(),
												row.activatedAt ? fmt.format(row.activatedAt) : DASH
											)}
											<!-- v1 columns: retired from the form, retained for historical rows. -->
											{@render detail(
												m.admin_waitlist_col_size(),
												labelled(row.companySize, waitlistCompanySizeLabel)
											)}
											{@render detail(m.admin_waitlist_col_interest(), orDash(row.interest))}
											{@render detail(
												m.admin_waitlist_col_heard(),
												labelled(row.hearAbout, waitlistReferralLabel)
											)}
										</dl>
									</details>
								</td>
							</tr>
						</tbody>
					{/each}
				</table>
			</div>

			<!-- Two standing caveats, kept next to the data they qualify rather than in a doc nobody
			     reads at 2am: the priority band is our own guess, and the outreach fields are claims. -->
			<p class="mt-5 px-2 text-xs text-faint">{m.admin_waitlist_internal_note()}</p>
			<p class="mt-1.5 px-2 text-xs text-faint">{m.admin_waitlist_unverified_note()}</p>
		{/if}
	</div>
</section>
