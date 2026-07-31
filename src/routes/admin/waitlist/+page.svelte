<script lang="ts">
	// Gated admin view of waitlist signups — sibling of the contact-submissions triage view. Reached
	// only past the /admin route guard (../+layout.server.ts). Same frosted-glass aesthetic.
	//
	// DAR-65 turned it from a flat log into a triage surface: every row carries its internal lead
	// class (decided server-side, never here), rows sort priority-first, the chips filter by class
	// through a plain GET so it all works without JS, and each row opens a <details> with the full v2
	// qualification answers.
	//
	// DAR-88 made one row a PERSON rather than a submission. Signups are append-only, so a lead can
	// hold several submissions, and the job of this view is to show them side by side WITHOUT picking
	// a winner: the summary columns read from the newest submission, any field the submissions
	// disagree about is flagged, and the detail lists every submission in full with its own timestamp
	// and priority band. Nothing here merges — that judgement is the operator's, and the outcome of it
	// goes wherever they take it, not into a column.
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
	import { mayContactLead } from '$lib/waitlist-outreach';
	import type { WaitlistRole } from '$lib/waitlist-roles';
	import type { WaitlistV2Role } from '$lib/waitlist-qualification';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Lead = PageData['leads'][number];
	type Submission = Lead['submissions'][number];

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

	// `role` holds BOTH the v1 slug set (legacy submissions) and the v2 set (DAR-61's step 2 writes the
	// same column), so resolve it against both label maps — v2 first — before the raw-slug fallback.
	const roleFor = (v: string | null) =>
		v
			? (waitlistV2RoleLabel[v as WaitlistV2Role]?.() ??
				waitlistRoleLabel[v as WaitlistRole]?.() ??
				v)
			: DASH;

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const atCap = $derived(data.total >= data.limit);

	// The summary columns read the NEWEST submission — the most recent thing this person told us —
	// rather than an aggregate across submissions. An aggregate would have to choose, and choosing is
	// exactly what this page refuses to do; where the choice would have mattered, the conflict chip
	// says so and the detail below shows every value.
	const latestOf = (lead: Lead): Submission | undefined => lead.submissions[0];

	// Field labels for the conflict list, keyed by the collator's field names. Reuses the same message
	// each field's detail row uses, so a renamed label can't say two different things on one page.
	const conflictLabel: Record<string, () => string> = {
		name: m.admin_col_name,
		company: m.admin_col_company,
		role: m.admin_waitlist_col_role,
		companySize: m.admin_waitlist_col_size,
		interest: m.admin_waitlist_col_interest,
		hearAbout: m.admin_waitlist_col_heard,
		phone: m.admin_waitlist_col_phone,
		countryRegion: m.admin_waitlist_field_region,
		primaryApplication: m.admin_waitlist_field_application,
		evaluationTimeline: m.admin_waitlist_field_timeline,
		currentApproach: m.admin_waitlist_field_approach,
		economicImpact: m.admin_waitlist_field_impact,
		budgetRange: m.admin_waitlist_field_budget,
		adoptionEvidence: m.admin_waitlist_field_evidence,
		pilotInterest: m.admin_waitlist_field_pilot,
		deploymentScale: m.admin_waitlist_field_deployment,
		contactPermission: m.admin_waitlist_col_outreach,
		contactMethod: m.admin_waitlist_field_contact_method,
		researchPreferences: m.admin_waitlist_field_research_prefs
	};
	const conflictNames = (fields: readonly string[]): string =>
		fields.map((f) => conflictLabel[f]?.() ?? f).join(', ');

	// Invite outcome (DAR-67). `form` is a union across the actions, so narrow on the namespace key
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
			// Both of these need the operator to go and DO something else first, so they get their own
			// copy — "try again" would send them round the same loop.
			case 'account_disabled':
				return m.admin_waitlist_invite_error_disabled();
			// The account exists but nothing was mailed, so the row is still un-invited and the button
			// still reads Invite. Worth its own message: "try again" is genuinely the right next move,
			// unlike the generic failure where something may be structurally wrong.
			case 'email_failed':
			case 'email_unconfigured':
				return m.admin_waitlist_invite_error_email();
			// Reachable even though the button is hidden for a flagged lead (DAR-191): a form action is a
			// public POST, and a stale page rendered before the flag was recorded still carries the button.
			// Its own copy, because the next move is not "try again" but "was that request withdrawn?".
			case 'do_not_contact':
				return m.admin_waitlist_invite_error_donotcontact();
			default:
				return m.admin_waitlist_invite_error();
		}
	}

	// Recorded-opt-out outcome (DAR-140), narrowed on its own namespace key exactly like the invite
	// above — `form` is a union across five actions now, and `ok`/`error` alone would match any of them.
	const optOut = $derived(form && 'optOut' in form ? form.optOut : null);
	const optOutOk = $derived(optOut && 'ok' in optOut ? optOut : null);
	const optOutError = $derived(optOut && 'error' in optOut ? optOut.error : null);
	// `not_found` gets its own line because the operator's next move differs: the row went away between
	// render and click, so re-pressing is pointless and reloading is the answer.
	const optOutErrorMessage = (code: string): string =>
		code === 'not_found'
			? m.admin_waitlist_updates_optout_error_gone()
			: m.admin_waitlist_updates_optout_error();

	// Who recorded a withdrawal, for the lead detail. NULL WITH A TIMESTAMP IS NOT MISSING DATA — it is
	// the recipient having pressed the emailed link themselves, which is the strongest evidence there
	// is, so rendering the usual em-dash would report our best record as an absence.
	const optOutRecordedBy = (lead: Lead): string =>
		lead.updatesUnsubscribedAt === null
			? DASH
			: (lead.updatesUnsubscribedBy ?? m.admin_waitlist_updates_optout_self());

	// Do-not-contact outcome (DAR-191). One namespace shared by the record and the lift actions, since
	// an operator only ever sees one of them at a time and the success line names which happened.
	const doNotContact = $derived(form && 'doNotContact' in form ? form.doNotContact : null);
	const doNotContactOk = $derived(doNotContact && 'ok' in doNotContact ? doNotContact : null);
	const doNotContactError = $derived(
		doNotContact && 'error' in doNotContact ? doNotContact.error : null
	);
	const doNotContactErrorMessage = (code: string): string =>
		code === 'not_found'
			? m.admin_waitlist_donotcontact_error_gone()
			: m.admin_waitlist_donotcontact_error();

	// NOT `optOutRecordedBy`'s rule, and the difference is which meanings a null actually HAS. There a
	// null recorder is the recipient having pressed the emailed link — our strongest record, so an
	// em-dash would report it as an absence. Here no code path produces one: this axis has no
	// self-service link, so every recorded request carries the staff id that recorded it. A null beside
	// a timestamp is therefore an anomaly (a direct write), and the honest rendering of "we do not know
	// who recorded this" is the dash. Naming a party we cannot identify would be a fabrication in the
	// one column an operator consults to answer "who did this, and on whose word?".
	// If a self-service route is ever added, this is where DAR-140's vocabulary comes back — and it
	// should come back with it, not before.

	const basePath = $derived(localizeHref('/admin/waitlist'));
	// SvelteKit reads the action name from the `?/name` key, so extra params ride alongside it. A bare
	// `?/delete` would resolve to /admin/waitlist?/delete and drop `class=`, bouncing the operator out
	// of the band they were working.
	const withFilter = (action: string) =>
		data.filter ? `?/${action}&class=${data.filter}` : `?/${action}`;
	const deleteAction = $derived(withFilter('delete'));
	const deleteSubmissionAction = $derived(withFilter('deleteSubmission'));
	const inviteAction = $derived(withFilter('invite'));
	const reviewAction = $derived(withFilter('review'));
	const optOutAction = $derived(withFilter('recordOptOut'));
	const doNotContactAction = $derived(withFilter('recordDoNotContact'));
	const liftDoNotContactAction = $derived(withFilter('liftDoNotContact'));

	const chipBase =
		'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500';
	const chipActive = 'bg-white/10 text-white';
	const chipIdle = 'text-faint hover:text-white';
	const tagBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
	const summaryBase =
		'inline-flex cursor-pointer list-none items-center rounded px-2 py-1 text-xs font-medium transition-colors [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-1';
</script>

<Seo
	title={m.admin_waitlist_page_title()}
	description={m.admin_waitlist_page_description()}
	noindex
/>

<!-- One label/value pair in a submission's detail. `conflict` marks a field whose answers differ
     between this lead's submissions — the marker is what replaces the merge we deliberately don't
     do, so it carries real TEXT, not just a colour and a glyph: `title` on a <span> is not reliably
     announced, so the glyph is aria-hidden and the label is sr-only beside it. -->
{#snippet detail(label: string, value: string, conflict = false)}
	<div>
		<dt class="text-xs tracking-wide text-faint">
			{label}{#if conflict}<span
					class="ml-1 text-warning-400"
					title={m.admin_waitlist_conflict_marker()}
					><span aria-hidden="true">&#8800;</span><span class="sr-only"
						>{m.admin_waitlist_conflict_marker()}</span
					></span
				>{/if}
		</dt>
		<dd class="text-sm break-words text-body">{value}</dd>
	</div>
{/snippet}

<!-- Every answer one submission carried. Rendered once per submission, so two submissions under one
     lead show two complete sets rather than a reconciled one. -->
{#snippet answers(row: Submission, conflicts: readonly string[])}
	<dl class="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
		{@render detail(m.admin_col_name(), orDash(row.name), conflicts.includes('name'))}
		{@render detail(m.admin_col_company(), orDash(row.company), conflicts.includes('company'))}
		{@render detail(m.admin_waitlist_col_role(), roleFor(row.role), conflicts.includes('role'))}
		{@render detail(
			m.admin_waitlist_field_region(),
			labelled(row.countryRegion, waitlistRegionLabel),
			conflicts.includes('countryRegion')
		)}
		{@render detail(
			m.admin_waitlist_field_application(),
			labelled(row.primaryApplication, waitlistApplicationLabel),
			conflicts.includes('primaryApplication')
		)}
		{@render detail(
			m.admin_waitlist_field_timeline(),
			labelled(row.evaluationTimeline, waitlistTimelineLabel),
			conflicts.includes('evaluationTimeline')
		)}
		{@render detail(
			m.admin_waitlist_field_approach(),
			labelled(row.currentApproach, waitlistApproachLabel),
			conflicts.includes('currentApproach')
		)}
		{@render detail(
			m.admin_waitlist_field_impact(),
			labelled(row.economicImpact, waitlistImpactLabel),
			conflicts.includes('economicImpact')
		)}
		{@render detail(
			m.admin_waitlist_field_budget(),
			labelled(row.budgetRange, waitlistBudgetLabel),
			conflicts.includes('budgetRange')
		)}
		{@render detail(
			m.admin_waitlist_field_evidence(),
			labelledList(row.adoptionEvidence, waitlistEvidenceLabel),
			conflicts.includes('adoptionEvidence')
		)}
		{@render detail(
			m.admin_waitlist_field_pilot(),
			labelled(row.pilotInterest, waitlistPilotInterestLabel),
			conflicts.includes('pilotInterest')
		)}
		{@render detail(
			m.admin_waitlist_field_deployment(),
			orDash(row.deploymentScale),
			conflicts.includes('deploymentScale')
		)}
		{@render detail(
			m.admin_waitlist_field_contact_method(),
			labelled(row.contactMethod, waitlistContactMethodLabel),
			conflicts.includes('contactMethod')
		)}
		{@render detail(m.admin_waitlist_col_phone(), orDash(row.phone), conflicts.includes('phone'))}
		{@render detail(
			m.admin_waitlist_field_research_prefs(),
			labelledList(row.researchPreferences, waitlistResearchPreferenceLabel),
			conflicts.includes('researchPreferences')
		)}
		<!-- Consent is per submission since DAR-88, with its own timestamp — better provenance for a
		     compliance review than the monotonic flag it replaces, and still an unverified claim. -->
		{@render detail(
			m.admin_waitlist_field_consent(),
			row.consentUpdates ? m.admin_waitlist_consent_yes() : m.admin_waitlist_consent_no()
		)}
		{@render detail(
			m.admin_waitlist_field_consent_at(),
			row.consentUpdatesAt ? fmt.format(row.consentUpdatesAt) : DASH
		)}
		{@render detail(m.admin_waitlist_field_step(), orDash(row.qualificationStep))}
		{@render detail(m.admin_waitlist_field_updated(), fmt.format(row.updatedAt))}
		<!-- v1 columns: retired from the form, retained for historical submissions. -->
		{@render detail(
			m.admin_waitlist_col_size(),
			labelled(row.companySize, waitlistCompanySizeLabel),
			conflicts.includes('companySize')
		)}
		{@render detail(
			m.admin_waitlist_col_interest(),
			orDash(row.interest),
			conflicts.includes('interest')
		)}
		{@render detail(
			m.admin_waitlist_col_heard(),
			labelled(row.hearAbout, waitlistReferralLabel),
			conflicts.includes('hearAbout')
		)}
	</dl>
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

	<!-- Recorded opt-out (DAR-140), at the top for the invite's reason and one of its own: this write
	     cannot be undone from here, so the confirmation has to name the address it hit rather than
	     leaving the operator to find a changed badge somewhere in 200 rows. -->
	{#if optOutOk}
		<p class="text-sm text-success-400" role="status">
			{m.admin_waitlist_updates_optout_done({ email: optOutOk.email })}
		</p>
	{:else if optOutError}
		<p class="text-sm text-error-400" role="alert">{optOutErrorMessage(optOutError)}</p>
	{/if}

	<!-- Do-not-contact (DAR-191), at the top for the same reason, and naming the address for a sharper
	     one: the record is durable and only an admin can undo it, so an operator who hit the row above
	     the one they meant has to be able to see that immediately. Record and lift share the namespace,
	     so the success line distinguishes them rather than the surrounding markup. -->
	{#if doNotContactOk}
		<p class="text-sm text-success-400" role="status">
			{'lifted' in doNotContactOk
				? m.admin_waitlist_donotcontact_lifted({ email: doNotContactOk.email })
				: m.admin_waitlist_donotcontact_done({ email: doNotContactOk.email })}
		</p>
	{:else if doNotContactError}
		<p class="text-sm text-error-400" role="alert">
			{doNotContactErrorMessage(doNotContactError)}
		</p>
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
				<span class="ml-2 font-medium text-emphasis tabular-nums"
					>{data.conversion === null
						? DASH
						: new Intl.NumberFormat('en-US', {
								style: 'percent',
								maximumFractionDigits: 1
							}).format(data.conversion)}</span
				>
			</p>
		</div>

		{#if data.funnel}
			<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
				{#each WAITLIST_FUNNEL_EVENTS as event (event)}
					<div>
						<dt class="text-xs tracking-wide text-faint">{waitlistFunnelEventLabel[event]()}</dt>
						<dd class="text-lg text-white tabular-nums">
							{new Intl.NumberFormat('en-US').format(data.funnel[event])}
						</dd>
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
		{:else if data.leads.length === 0}
			<p class="px-2 py-12 text-center text-sm text-faint">{m.admin_waitlist_filter_empty()}</p>
		{:else}
			<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-2 pb-4">
				<p class="text-sm text-emphasis">
					{m.admin_waitlist_count({
						count: data.leads.length,
						submissions: data.submissionTotal
					})}
				</p>
				{#if data.reviewTotal > 0}
					<p class="text-xs text-warning-400">
						{m.admin_waitlist_review_pending({ count: data.reviewTotal })}
					</p>
				{/if}
			</div>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-hairline text-xs tracking-wide text-faint">
							<th class="px-3 py-2 font-medium whitespace-nowrap">{m.admin_waitlist_col_class()}</th
							>
							<th class="px-3 py-2 font-medium whitespace-nowrap"
								>{m.admin_waitlist_col_latest()}</th
							>
							<th class="px-3 py-2 font-medium">{m.admin_col_email()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_name()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_company()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_role()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_outreach()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_updates()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_access()}</th>
							<th class="px-3 py-2 text-right font-medium">
								<span class="sr-only">{m.admin_col_actions()}</span>
							</th>
						</tr>
					</thead>
					<!-- One <tbody> per LEAD: the summary row and its submissions belong together, and
					     grouping lets the divider fall between people instead of inside one. -->
					{#each data.leads as lead (lead.id)}
						<!-- One named rule for "is this a repeat invitation", shared with the server side
						     ($lib/waitlist-invite.ts) rather than re-derived per label below. -->
						{@const resend = isWaitlistResend(lead.inviteState)}
						{@const latest = latestOf(lead)}
						<tbody class="border-b border-hairline">
							<tr class="align-top">
								<td class="px-3 py-3"><WaitlistLeadClassBadge leadClass={lead.leadClass} /></td>
								<td class="px-3 py-3 whitespace-nowrap text-faint"
									>{lead.latestAt ? fmt.format(lead.latestAt) : DASH}</td
								>
								<td class="px-3 py-3">
									<a
										href={`mailto:${lead.email}`}
										class="text-body transition-colors hover:text-primary-500">{lead.email}</a
									>
									<!-- The three things that only exist because submissions are append-only: how
									     many there are, whether they disagree, and whether a human has looked
									     since the newest one arrived. -->
									<div class="mt-1 flex flex-wrap items-center gap-1.5">
										{#if lead.submissions.length > 1}
											<span class="{tagBase} bg-white/10 text-body"
												>{m.admin_waitlist_detail_show_n({ count: lead.submissions.length })}</span
											>
										{/if}
										{#if lead.conflicts.length > 0}
											<span class="{tagBase} bg-warning-500/15 text-warning-300"
												>{m.admin_waitlist_conflict_badge({ count: lead.conflicts.length })}</span
											>
										{/if}
										{#if lead.needsReview}
											<span class="text-xs text-warning-400">{m.admin_waitlist_needs_review()}</span
											>
										{:else if lead.reviewedAt}
											<span class="text-xs text-faint"
												>{m.admin_waitlist_reviewed_at({ date: fmt.format(lead.reviewedAt) })}</span
											>
										{/if}
									</div>
								</td>
								<td class="px-3 py-3 text-emphasis">{orDash(latest?.name ?? null)}</td>
								<td class="px-3 py-3 text-body">{orDash(latest?.company ?? null)}</td>
								<td class="px-3 py-3 whitespace-nowrap text-body"
									>{roleFor(latest?.role ?? null)}</td
								>
								<td class="px-3 py-3 whitespace-nowrap">
									<!-- THE LEAD-LEVEL TRUTH WINS THIS CELL (DAR-191). Below it is a tri-state read
									     off the newest SUBMISSION — an answer somebody typed into an unauthenticated
									     form, which under append-only need not be the person whose address it is.
									     "Do not contact" is where that person themselves now stands, so it replaces
									     the claim rather than sitting beside it; the per-submission answers are all
									     still in the detail panel, where they can be read as the claims they are.
									     Exactly how the Updates column already treats `consent_updates`. -->
									{#if !mayContactLead(lead)}
										<span class="{tagBase} bg-warning-500/15 text-warning-300"
											>{m.admin_waitlist_donotcontact_badge()}</span
										>
										<!-- Tri-state, from the NEWEST submission: null = never asked (the pilot answer
									     wasn't positive), false = asked and declined, true = granted. A grant is the
									     one worth spotting — and a grant this lead's submissions disagree about
									     carries the conflict chip above, which is the honest reading of "someone
									     said yes and someone said no under this address". -->
									{:else if latest?.contactPermission === true}
										<span class="{tagBase} bg-success-500/15 text-success-300"
											>{m.admin_waitlist_outreach_granted()}</span
										>
									{:else if latest?.contactPermission === false}
										<span class="text-xs text-body">{m.admin_waitlist_outreach_declined()}</span>
									{:else}
										<span class="text-xs text-faint">{m.admin_waitlist_outreach_unasked()}</span>
									{/if}
								</td>
								<td class="px-3 py-3 whitespace-nowrap">
									<!-- Where this address stands on product-and-research updates (DAR-139), derived
									     from the LEAD — deliberately BESIDE the per-submission "Marketing consent"
									     row in the detail panel rather than replacing it. Those say what each
									     submitter typed into an unauthenticated form; this says whether the mailbox
									     itself ever answered, which is the only thing that authorizes a send.
									     "Opted out" is styled as the loudest of the four for the same reason the
									     conflict chip is: it is the one an operator must not act against. -->
									{#if lead.updatesState === 'unsubscribed'}
										<span class="{tagBase} bg-warning-500/15 text-warning-300"
											>{m.admin_waitlist_updates_unsubscribed()}</span
										>
									{:else if lead.updatesState === 'confirmed'}
										<span class="{tagBase} bg-success-500/15 text-success-300"
											>{m.admin_waitlist_updates_confirmed()}</span
										>
									{:else if lead.updatesState === 'asked'}
										<span class="text-xs text-body">{m.admin_waitlist_updates_asked()}</span>
									{:else}
										<span class="text-xs text-faint">{m.admin_waitlist_updates_none()}</span>
									{/if}
								</td>
								<td class="px-3 py-3 whitespace-nowrap">
									<!-- Invite state (DAR-67), derived server-side from the LEAD's
									     invited_at/activated_at. Three states, and only the last is self-evidently
									     good news: "invited" means an email went out, not that anyone acted on it. -->
									{#if lead.inviteState === 'activated'}
										<span class="{tagBase} bg-success-500/15 text-success-300"
											>{m.admin_waitlist_invite_activated()}</span
										>
									{:else if lead.inviteState === 'invited'}
										<span class="{tagBase} bg-white/10 text-body"
											>{m.admin_waitlist_invite_invited()}</span
										>
									{:else}
										<span class="text-xs text-faint">{m.admin_waitlist_invite_not_invited()}</span>
									{/if}
								</td>
								<td class="px-3 py-3 text-right align-top">
									<!-- Invite / resend. Same two-step <details> confirm as delete below, and for the
									     same reason rather than for symmetry: one click here puts a real email in a
									     prospect's inbox. A lead that has already been invited says "Resend" — DAR-67
									     requires a re-invite to be an explicit act, never an accidental duplicate.

									     GONE ENTIRELY for a do-not-contact lead (DAR-191), replaced by a line saying
									     why — never left in place to be refused on click, which would read as a bug
									     rather than as a decision. This is cosmetic all the same: the action itself
									     refuses, because a form action is a public POST and a page rendered before the
									     flag was recorded still carries the button. -->
									{#if !mayContactLead(lead)}
										<p class="mb-1.5 text-xs text-faint">
											{m.admin_waitlist_donotcontact_no_invite()}
										</p>
									{:else}
										<details class="mb-1.5 inline-block text-right">
											<summary
												class="{summaryBase} text-primary-500 hover:bg-primary-500/10 focus-visible:ring-primary-500"
												>{resend
													? m.admin_waitlist_invite_resend()
													: m.admin_waitlist_invite()}</summary
											>
											<form method="post" action={inviteAction} class="mt-1.5">
												<input type="hidden" name="id" value={lead.id} />
												<button
													type="submit"
													class="rounded bg-primary-500/20 px-2 py-1 text-xs font-medium text-primary-200 transition-colors hover:bg-primary-500/30 focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:outline-none"
													aria-label={resend
														? m.admin_waitlist_invite_resend_sr({ email: lead.email })
														: m.admin_waitlist_invite_sr({ email: lead.email })}
													>{resend
														? m.admin_waitlist_invite_resend_confirm()
														: m.admin_waitlist_invite_confirm()}</button
												>
											</form>
										</details>
									{/if}

									<!-- "I have reconciled this person's submissions" (DAR-88). One click, no confirm
									     step: it writes a timestamp and nothing else, and a new submission re-opens
									     the lead by itself. -->
									<form method="post" action={reviewAction} class="mb-1.5 inline-block">
										<input type="hidden" name="id" value={lead.id} />
										<button
											type="submit"
											class="{summaryBase} text-faint hover:bg-white/5 hover:text-white focus-visible:ring-primary-500"
											aria-label={m.admin_waitlist_review_sr({ email: lead.email })}
											>{m.admin_waitlist_review()}</button
										>
									</form>

									<!-- Record an updates opt-out on this person's behalf (DAR-140) — for the request
									     that arrives by reply or phone rather than through the unsubscribe link every
									     message carries. Writes what that link writes, so honoring it by hand leaves
									     the same durable state.
									     Two-step confirm for the delete/invite reason, and more so: nothing on this
									     page undoes it. Hidden once the address has already withdrawn — the write is
									     idempotent, but a control that can only be a no-op is noise in a column an
									     operator scans. Shown for `none` on purpose: someone whose address a stranger
									     typed in has never been asked and wants never to be. -->
									{#if lead.updatesState !== 'unsubscribed'}
										<details class="mb-1.5 inline-block text-right">
											<summary
												class="{summaryBase} text-warning-300 hover:bg-warning-500/10 focus-visible:ring-warning-500"
												>{m.admin_waitlist_updates_optout()}</summary
											>
											<form method="post" action={optOutAction} class="mt-1.5">
												<input type="hidden" name="id" value={lead.id} />
												<button
													type="submit"
													class="rounded bg-warning-500/20 px-2 py-1 text-xs font-medium text-warning-200 transition-colors hover:bg-warning-500/30 focus-visible:ring-1 focus-visible:ring-warning-500 focus-visible:outline-none"
													aria-label={m.admin_waitlist_updates_optout_sr({ email: lead.email })}
													>{m.admin_waitlist_updates_optout_confirm()}</button
												>
											</form>
										</details>
									{/if}

									<!-- Record "don't contact me" (DAR-191) — the OTHER consent axis, deliberately its
									     own control rather than a second effect of the one above. They answer different
									     requests: that one stops a mailing list this mailbox joined, this one stops us
									     reaching out. Same two-step confirm, and for a sharper version of the same
									     reason: this one an operator cannot undo at all.
									     Shown for every un-flagged lead, invited or not — "stop contacting me" is a
									     thing somebody can say at any point, including before we ever wrote to them. -->
									{#if mayContactLead(lead)}
										<details class="mb-1.5 inline-block text-right">
											<summary
												class="{summaryBase} text-warning-300 hover:bg-warning-500/10 focus-visible:ring-warning-500"
												>{m.admin_waitlist_donotcontact()}</summary
											>
											<form method="post" action={doNotContactAction} class="mt-1.5">
												<input type="hidden" name="id" value={lead.id} />
												<button
													type="submit"
													class="rounded bg-warning-500/20 px-2 py-1 text-xs font-medium text-warning-200 transition-colors hover:bg-warning-500/30 focus-visible:ring-1 focus-visible:ring-warning-500 focus-visible:outline-none"
													aria-label={m.admin_waitlist_donotcontact_sr({ email: lead.email })}
													>{m.admin_waitlist_donotcontact_confirm()}</button
												>
											</form>
										</details>
										<!-- Lifting it is ADMIN ONLY, which is why this is the one control on the page
										     gated on anything but `isStaff`. An operator who wants to invite a flagged
										     lead must go and ask, rather than clicking past the request; `data.isAdmin`
										     comes from the /admin layout and the action re-checks it, since hiding a
										     form is not authorization. -->
									{:else if data.isAdmin}
										<details class="mb-1.5 inline-block text-right">
											<summary
												class="{summaryBase} text-faint hover:bg-white/5 hover:text-white focus-visible:ring-primary-500"
												>{m.admin_waitlist_donotcontact_lift()}</summary
											>
											<form method="post" action={liftDoNotContactAction} class="mt-1.5">
												<input type="hidden" name="id" value={lead.id} />
												<button
													type="submit"
													class="rounded bg-white/10 px-2 py-1 text-xs font-medium text-body transition-colors hover:bg-white/20 focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:outline-none"
													aria-label={m.admin_waitlist_donotcontact_lift_sr({ email: lead.email })}
													>{m.admin_waitlist_donotcontact_lift_confirm()}</button
												>
											</form>
										</details>
									{/if}

									<!-- Two-step confirm, no JS: the <summary> reveals the delete button; clicking it
									     again cancels. Avoids a one-click misclick without needing confirm(). This
									     one takes the whole person AND every submission (schema cascade), so the
									     screen-reader label says so. -->
									<details class="inline-block text-right">
										<summary
											class="{summaryBase} text-error-400 hover:bg-error-500/10 focus-visible:ring-error-500"
											>{m.admin_delete()}</summary
										>
										<form method="post" action={deleteAction} class="mt-1.5">
											<input type="hidden" name="id" value={lead.id} />
											<button
												type="submit"
												class="rounded bg-error-500/20 px-2 py-1 text-xs font-medium text-error-200 transition-colors hover:bg-error-500/30 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
												aria-label={m.admin_waitlist_delete_sr({ email: lead.email })}
												>{m.admin_delete_confirm()}</button
											>
										</form>
									</details>
								</td>
							</tr>
							<tr>
								<!-- Spans the whole header row — 10 columns since DAR-139 added Updates. -->
								<td colspan="10" class="px-3 pb-3">
									<details>
										<summary
											aria-label={m.admin_waitlist_detail_sr({ email: lead.email })}
											class="inline-flex cursor-pointer items-center rounded text-xs text-faint transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:outline-none"
											>{m.admin_waitlist_detail_show_n({ count: lead.submissions.length })}</summary
										>

										{#if lead.conflicts.length > 0}
											<!-- Named up front so the operator knows what to compare before scrolling
											     through two full answer sets. -->
											<p class="mt-3 text-xs text-warning-300">
												{m.admin_waitlist_conflict_list({
													fields: conflictNames(lead.conflicts)
												})}
											</p>
										{/if}

										<!-- Newest first: the most recent claim is the one an operator is usually
										     reacting to, and the older ones are the context for judging it. -->
										{#each lead.submissions as row, index (row.id)}
											<article class="mt-4 border-t border-hairline pt-3 first:border-t-0">
												<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
													<div class="flex flex-wrap items-center gap-2">
														<span class="text-xs text-faint"
															><!-- Counted from the OLDEST, while the list renders newest-first: "Submission
															     3 of 3" is the most recent one, which is how a person would describe their
															     own third attempt. `index + 1` would label the newest as "1 of 3". -->{m.admin_waitlist_submission_n(
																{
																	n: lead.submissions.length - index,
																	total: lead.submissions.length
																}
															)}</span
														>
														<span class="text-xs text-body">{fmt.format(row.createdAt)}</span>
														<!-- Per-submission band, so the lead's badge above is attributable
														     rather than an unexplained aggregate. -->
														<WaitlistLeadClassBadge leadClass={row.leadClass} />
													</div>
													<!-- Drop ONE junk submission without discarding the person. This is the
													     operator's answer to append-only's accepted cost: anyone can submit
													     a known address, so there has to be a way to delete a claim rather
													     than a prospect. -->
													<details class="text-right">
														<summary
															class="{summaryBase} text-error-400 hover:bg-error-500/10 focus-visible:ring-error-500"
															>{m.admin_waitlist_delete_submission()}</summary
														>
														<form method="post" action={deleteSubmissionAction} class="mt-1.5">
															<input type="hidden" name="id" value={row.id} />
															<button
																type="submit"
																class="rounded bg-error-500/20 px-2 py-1 text-xs font-medium text-error-200 transition-colors hover:bg-error-500/30 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
																aria-label={m.admin_waitlist_delete_submission_sr({
																	email: lead.email
																})}>{m.admin_delete_confirm()}</button
															>
														</form>
													</details>
												</div>
												{@render answers(row, lead.conflicts)}
											</article>
										{/each}

										<!-- Lead-level state: our own actions, not anything the person submitted, which
										     is exactly why these live on the lead and outside the per-submission
										     blocks above. -->
										<dl
											class="mt-4 grid gap-x-6 gap-y-3 border-t border-hairline pt-3 sm:grid-cols-2 lg:grid-cols-3"
										>
											<!-- `invited_at` is the LAST send, not the first — a resend overwrites it —
											     so the durable history is the per-invite Workers Logs line, not this.
											     `invited_by` is a staff user id: the roster is a different query, and
											     resolving a name per row would cost one. -->
											{@render detail(
												m.admin_waitlist_field_invited(),
												lead.invitedAt ? fmt.format(lead.invitedAt) : DASH
											)}
											{@render detail(m.admin_waitlist_field_invited_by(), orDash(lead.invitedBy))}
											{@render detail(
												m.admin_waitlist_field_activated(),
												lead.activatedAt ? fmt.format(lead.activatedAt) : DASH
											)}
											{@render detail(
												m.admin_waitlist_field_reviewed_by(),
												orDash(lead.reviewedBy)
											)}
											<!-- The updates trail (DAR-139/DAR-140). The column above is one badge; what
											     a request about consent actually asks is WHEN each thing happened and, for
											     the withdrawal, WHO recorded it — which stopped being derivable from the
											     timestamp alone the moment staff could record one too. -->
											{@render detail(
												m.admin_waitlist_field_updates_asked(),
												lead.updatesConfirmSentAt ? fmt.format(lead.updatesConfirmSentAt) : DASH
											)}
											{@render detail(
												m.admin_waitlist_field_updates_confirmed(),
												lead.updatesConfirmedAt ? fmt.format(lead.updatesConfirmedAt) : DASH
											)}
											{@render detail(
												m.admin_waitlist_field_updates_optout(),
												lead.updatesUnsubscribedAt ? fmt.format(lead.updatesUnsubscribedAt) : DASH
											)}
											{@render detail(
												m.admin_waitlist_field_updates_optout_by(),
												optOutRecordedBy(lead)
											)}
											<!-- The outreach axis (DAR-191). Beside the updates trail rather than folded into
											     it, because they answer different questions — and the column badge is a
											     yes/no, while what somebody asking about their own record wants is when it
											     was recorded and by whom. Cleared outright by a lift, so a blank pair here
											     means "nothing recorded", never "recorded and then withdrawn": that history
											     is the [outreach] Workers Logs line. -->
											{@render detail(
												m.admin_waitlist_field_donotcontact(),
												lead.doNotContactAt ? fmt.format(lead.doNotContactAt) : DASH
											)}
											{@render detail(
												m.admin_waitlist_field_donotcontact_by(),
												orDash(lead.doNotContactBy)
											)}
										</dl>
									</details>
								</td>
							</tr>
						</tbody>
					{/each}
				</table>
			</div>

			<!-- Standing caveats, kept next to the data they qualify rather than in a doc nobody reads at
			     2am: the priority band is our own guess, the outreach fields are claims, submissions are
			     never merged, and deleting a lead takes its submissions with it. -->
			<p class="mt-5 px-2 text-xs text-faint">{m.admin_waitlist_internal_note()}</p>
			<p class="mt-1.5 px-2 text-xs text-faint">{m.admin_waitlist_unverified_note()}</p>
			<p class="mt-1.5 px-2 text-xs text-faint">{m.admin_waitlist_conflict_note()}</p>
			<p class="mt-1.5 px-2 text-xs text-faint">{m.admin_waitlist_appendonly_note()}</p>
			<p class="mt-1.5 px-2 text-xs text-faint">{m.admin_waitlist_updates_optout_note()}</p>
			<!-- The one caveat here that is about a choice rather than about the data: two consent axes
			     exist and neither implies the other, so an operator honoring "stop everything" has to press
			     two buttons. Stated in the copy rather than solved in code on purpose — making one control
			     do both would silently cancel a subscription the recipient confirmed themselves. -->
			<p class="mt-1.5 px-2 text-xs text-faint">{m.admin_waitlist_donotcontact_note()}</p>
		{/if}
	</div>
</section>
