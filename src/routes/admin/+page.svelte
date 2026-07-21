<script lang="ts">
	// Gated admin view of contact submissions (#69) — the in-app triage surface that replaces
	// `pnpm db:studio` for reading leads. Reached only past the /admin route guard
	// (+layout.server.ts); rows come newest-first from +page.server.ts. Same CosmicBackdrop +
	// frosted-glass aesthetic as the rest of the site.
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { interestLabel } from '$lib/contact-interest-labels';
	import type { Interest } from '$lib/contact-interests';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Stored interest is a raw slug (or null). Map to its localized label; fall back to the raw
	// value if a legacy/unknown slug ever appears, and to an em-dash when absent.
	function labelFor(slug: string | null): string {
		if (!slug) return '—';
		return interestLabel[slug as Interest]?.() ?? slug;
	}

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const atCap = $derived(data.submissions.length >= data.limit);
</script>

<Seo title={m.admin_page_title()} description={m.admin_page_description()} noindex />

<section class="space-y-8">
	<header>
		<h1 class="text-3xl font-medium tracking-tight text-white">{m.admin_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.admin_lead()}</p>
	</header>

	{#if form && 'error' in form}
		<p class="text-sm text-error-400" role="alert">{m.admin_delete_error()}</p>
	{/if}

	<div class="glass-card p-4 sm:p-6">
		{#if data.submissions.length === 0}
			<p class="px-2 py-12 text-center text-sm text-faint">{m.admin_empty()}</p>
		{:else}
			<div class="flex flex-wrap items-baseline justify-between gap-2 px-2 pb-4">
				<span class="text-sm text-emphasis"
					>{m.admin_count({ count: data.submissions.length })}</span
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
							<th class="px-3 py-2 font-medium">{m.admin_col_name()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_email()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_company()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_interest()}</th>
							<th class="px-3 py-2 font-medium">{m.admin_col_message()}</th>
							<th class="px-3 py-2 text-right font-medium">
								<span class="sr-only">{m.admin_col_actions()}</span>
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-hairline">
						{#each data.submissions as sub (sub.id)}
							<tr class="align-top">
								<td class="px-3 py-3 whitespace-nowrap text-faint">{fmt.format(sub.createdAt)}</td>
								<td class="px-3 py-3 text-emphasis">{sub.name}</td>
								<td class="px-3 py-3">
									<a
										href={`mailto:${sub.email}`}
										class="text-body transition-colors hover:text-primary-500">{sub.email}</a
									>
								</td>
								<td class="px-3 py-3 text-body">{sub.company ?? '—'}</td>
								<td class="px-3 py-3 whitespace-nowrap text-body">{labelFor(sub.interest)}</td>
								<td class="max-w-sm px-3 py-3 text-body">
									<span class="block break-words whitespace-pre-wrap">{sub.message}</span>
								</td>
								<td class="px-3 py-3 text-right align-top">
									<!-- Two-step confirm, no JS: the <summary> reveals the actual delete button; clicking
									     the summary again cancels. Avoids a one-click misclick without needing confirm(). -->
									<details class="inline-block text-right">
										<summary
											class="inline-flex cursor-pointer list-none items-center rounded px-2 py-1 text-xs font-medium text-error-400 transition-colors [&::-webkit-details-marker]:hidden hover:bg-error-500/10 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
											>{m.admin_delete()}</summary
										>
										<form method="post" action="?/delete" class="mt-1.5">
											<input type="hidden" name="id" value={sub.id} />
											<button
												type="submit"
												class="rounded bg-error-500/20 px-2 py-1 text-xs font-medium text-error-200 transition-colors hover:bg-error-500/30 focus-visible:ring-1 focus-visible:ring-error-500 focus-visible:outline-none"
												aria-label={m.admin_delete_sr({ name: sub.name })}
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
