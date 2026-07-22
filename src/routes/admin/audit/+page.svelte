<script lang="ts">
	// Gated admin view of the login audit — every sign-in attempt (success + failure) newest-first,
	// written by the Better Auth after-hook (auth-audit.ts). Reached only past the /admin route guard
	// (+layout.server.ts). Same CosmicBackdrop + frosted-glass aesthetic as the submissions view.
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const atCap = $derived(data.attempts.length >= data.limit);
</script>

<Seo title={m.admin_audit_page_title()} description={m.admin_audit_page_description()} noindex />

<section class="space-y-8">
	<header>
		<h1 class="text-3xl font-medium tracking-tight text-white">{m.admin_audit_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.admin_audit_lead()}</p>
	</header>

	<div class="glass-card p-4 sm:p-6">
		{#if data.attempts.length === 0}
			<p class="px-2 py-12 text-center text-sm text-faint">{m.admin_audit_empty()}</p>
		{:else}
			<div class="flex flex-wrap items-baseline justify-between gap-2 px-2 pb-4">
				<span class="text-sm text-emphasis"
					>{m.admin_audit_count({ count: data.attempts.length })}</span
				>
				{#if atCap}
					<span class="text-xs text-faint">{m.admin_audit_cap_note({ limit: data.limit })}</span>
				{/if}
			</div>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-hairline text-xs tracking-wide text-faint">
							<th class="px-3 py-2 font-medium whitespace-nowrap">{m.admin_audit_col_time()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_audit_col_email()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_audit_col_outcome()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_audit_col_reason()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_audit_col_ip()}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-hairline">
						{#each data.attempts as attempt (attempt.id)}
							<tr class="align-top">
								<td class="px-3 py-3 whitespace-nowrap text-faint"
									>{fmt.format(attempt.createdAt)}</td
								>
								<td class="px-3 py-3 text-emphasis">{attempt.email ?? '—'}</td>
								<td class="px-3 py-3 whitespace-nowrap">
									{#if attempt.success}
										<span
											class="inline-flex items-center rounded-full bg-success-500/15 px-2 py-0.5 text-xs font-medium text-success-300"
											>{m.admin_audit_outcome_success()}</span
										>
									{:else}
										<span
											class="inline-flex items-center rounded-full bg-error-500/15 px-2 py-0.5 text-xs font-medium text-error-300"
											>{m.admin_audit_outcome_failure()}</span
										>
									{/if}
								</td>
								<td class="px-3 py-3 whitespace-nowrap text-body">{attempt.reason ?? '—'}</td>
								<td
									class="px-3 py-3 font-mono text-xs whitespace-nowrap text-body"
									title={attempt.userAgent ?? ''}>{attempt.ipAddress ?? '—'}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>
