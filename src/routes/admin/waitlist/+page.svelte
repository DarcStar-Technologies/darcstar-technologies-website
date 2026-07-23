<script lang="ts">
	// Gated admin view of waitlist signups — sibling of the contact-submissions triage view. Reached
	// only past the /admin route guard (../+layout.server.ts); rows come newest-first from
	// +page.server.ts. Same frosted-glass aesthetic. Slug columns (role/size/heard) map to their
	// localized labels; `interest` is free text, shown verbatim.
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { waitlistRoleLabel } from '$lib/waitlist-role-labels';
	import { waitlistCompanySizeLabel } from '$lib/waitlist-company-size-labels';
	import { waitlistReferralLabel } from '$lib/waitlist-referral-labels';
	import type { WaitlistRole } from '$lib/waitlist-roles';
	import type { WaitlistCompanySize } from '$lib/waitlist-company-sizes';
	import type { WaitlistReferralSource } from '$lib/waitlist-referral-sources';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Slug → localized label, falling back to the raw value for a legacy/unknown slug, em-dash when
	// absent. Free-text fields (interest) use `orDash` directly.
	const orDash = (v: string | null): string => v ?? '—';
	const roleFor = (v: string | null) => (v ? (waitlistRoleLabel[v as WaitlistRole]?.() ?? v) : '—');
	const sizeFor = (v: string | null) =>
		v ? (waitlistCompanySizeLabel[v as WaitlistCompanySize]?.() ?? v) : '—';
	const hearFor = (v: string | null) =>
		v ? (waitlistReferralLabel[v as WaitlistReferralSource]?.() ?? v) : '—';

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const atCap = $derived(data.signups.length >= data.limit);
</script>

<Seo
	title={m.admin_waitlist_page_title()}
	description={m.admin_waitlist_page_description()}
	noindex
/>

<section class="space-y-8">
	<header>
		<h1 class="text-3xl font-medium tracking-tight text-white">{m.admin_waitlist_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.admin_waitlist_lead()}</p>
	</header>

	{#if form && 'error' in form}
		<p class="text-sm text-error-400" role="alert">{m.admin_delete_error()}</p>
	{/if}

	<div class="glass-card p-4 sm:p-6">
		{#if data.signups.length === 0}
			<p class="px-2 py-12 text-center text-sm text-faint">{m.admin_waitlist_empty()}</p>
		{:else}
			<div class="flex flex-wrap items-baseline justify-between gap-2 px-2 pb-4">
				<span class="text-sm text-emphasis"
					>{m.admin_waitlist_count({ count: data.signups.length })}</span
				>
				{#if atCap}
					<span class="text-xs text-faint">{m.admin_cap_note({ limit: data.limit })}</span>
				{/if}
			</div>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-hairline text-xs tracking-wide text-faint">
							<th class="px-3 py-2 font-medium whitespace-nowrap">{m.admin_col_received()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_email()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_name()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_company()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_role()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_size()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_interest()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_heard()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_waitlist_col_phone()}</th>
							<th class="px-3 py-2 text-right font-medium">
								<span class="sr-only">{m.admin_col_actions()}</span>
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-hairline">
						{#each data.signups as row (row.id)}
							<tr class="align-top">
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
								<td class="px-3 py-3 whitespace-nowrap text-body">{sizeFor(row.companySize)}</td>
								<td class="max-w-xs px-3 py-3 text-body">
									<span class="block break-words">{orDash(row.interest)}</span>
								</td>
								<td class="px-3 py-3 whitespace-nowrap text-body">{hearFor(row.hearAbout)}</td>
								<td class="px-3 py-3 whitespace-nowrap text-body">{orDash(row.phone)}</td>
								<td class="px-3 py-3 text-right align-top">
									<!-- Two-step confirm, no JS: the <summary> reveals the delete button; clicking it
									     again cancels. Avoids a one-click misclick without needing confirm(). -->
									<details class="inline-block text-right">
										<summary
											class="inline-flex cursor-pointer list-none items-center rounded px-2 py-1 text-xs font-medium text-error-400 transition-colors [&::-webkit-details-marker]:hidden hover:bg-error-500/10 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
											>{m.admin_delete()}</summary
										>
										<form method="post" action="?/delete" class="mt-1.5">
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
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>
