<script lang="ts">
	// Operator roster (admin-only). Lists accounts that can sign in to the admin area, with a
	// "create operator" form. Per-account management lives on the detail page (row → Manage). Same
	// CosmicBackdrop + glass aesthetic as the rest of the admin area (backdrop is in the layout).
	import Seo from '$lib/components/Seo.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { enhance } from '$app/forms';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: FormResult } = $props();

	type FormResult = {
		create?: { values?: { email?: string; name?: string; role?: string }; error?: string };
	} | null;

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const atCap = $derived(data.users.length >= data.limit);

	let submitting = $state(false);
	const createErr = $derived(form?.create?.error ?? null);
	const createValues = $derived(form?.create?.values ?? {});

	function errorMessage(code: string): string {
		if (code === 'email_taken') return m.admin_users_error_email_taken();
		if (code === 'password_short') return m.admin_users_error_password_short();
		if (code === 'missing') return m.admin_users_error_missing();
		return m.admin_users_error_generic();
	}

	function roleLabel(role: string | null | undefined): string {
		return role === 'admin' ? m.admin_users_role_admin() : m.admin_users_role_operator();
	}
</script>

<Seo title={m.admin_users_page_title()} description={m.admin_users_page_description()} noindex />

<section class="space-y-8">
	<header>
		<h1 class="text-3xl font-medium tracking-tight text-white">{m.admin_users_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.admin_users_lead()}</p>
	</header>

	<!-- Create operator -->
	<div class="glass-card p-4 sm:p-6">
		<h2 class="text-lg font-medium text-white">{m.admin_users_create_heading()}</h2>
		<p class="mt-1 text-sm text-faint">{m.admin_users_create_lead()}</p>

		<form
			method="post"
			action="?/create"
			class="mt-4 space-y-4"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			{#if createErr}
				<ErrorBanner>{errorMessage(createErr)}</ErrorBanner>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
						>{m.admin_users_create_name_label()}</span
					>
					<input
						type="text"
						name="name"
						value={createValues.name ?? ''}
						required
						autocomplete="off"
						class={fieldClass}
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
						>{m.admin_users_create_email_label()}</span
					>
					<input
						type="email"
						name="email"
						value={createValues.email ?? ''}
						required
						autocomplete="off"
						class={fieldClass}
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
						>{m.admin_users_create_password_label()}</span
					>
					<input
						type="password"
						name="password"
						required
						minlength="8"
						autocomplete="new-password"
						class={fieldClass}
					/>
					<span class="mt-1 block text-xs text-faint">{m.admin_users_create_password_hint()}</span>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
						>{m.admin_users_create_role_label()}</span
					>
					<select name="role" class={fieldClass}>
						<option value="user" selected={createValues.role !== 'admin'}
							>{m.admin_users_role_operator()}</option
						>
						<option value="admin" selected={createValues.role === 'admin'}
							>{m.admin_users_role_admin()}</option
						>
					</select>
				</label>
			</div>

			<button type="submit" disabled={submitting} class={submitButtonClass}>
				{submitting ? m.admin_users_create_submitting() : m.admin_users_create_submit()}
			</button>
		</form>
	</div>

	<!-- Roster -->
	<div class="glass-card p-4 sm:p-6">
		<div class="flex flex-wrap items-baseline justify-between gap-2 px-2 pb-4">
			<span class="text-sm text-emphasis">{m.admin_users_count({ count: data.total })}</span>
			{#if atCap}
				<span class="text-xs text-faint">{m.admin_users_cap_note({ limit: data.limit })}</span>
			{/if}
		</div>
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-left text-sm">
				<thead>
					<tr class="border-b border-hairline text-xs tracking-wide text-faint">
						<th class="px-3 py-2 font-medium">{m.admin_users_col_email()}</th>
						<th class="px-3 py-2 font-medium">{m.admin_users_col_name()}</th>
						<th class="px-3 py-2 font-medium">{m.admin_users_col_role()}</th>
						<th class="px-3 py-2 font-medium">{m.admin_users_col_status()}</th>
						<th class="px-3 py-2 font-medium whitespace-nowrap">{m.admin_users_col_created()}</th>
						<th class="px-3 py-2 font-medium"
							><span class="sr-only">{m.admin_users_col_manage()}</span></th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-hairline">
					{#each data.users as u (u.id)}
						<tr class="align-top">
							<td class="px-3 py-3 text-emphasis">
								{u.email}
								{#if u.id === data.currentUserId}
									<span
										class="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tracking-wide text-faint"
										>{m.admin_users_badge_you()}</span
									>
								{:else if data.ownerIds.includes(u.id)}
									<span
										class="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tracking-wide text-faint"
										>{m.admin_users_badge_owner()}</span
									>
								{/if}
							</td>
							<td class="px-3 py-3 text-body">{u.name}</td>
							<td class="px-3 py-3 whitespace-nowrap text-body">{roleLabel(u.role)}</td>
							<td class="px-3 py-3 whitespace-nowrap">
								{#if u.banned}
									<span class="text-error-400">{m.admin_users_status_disabled()}</span>
								{:else}
									<span class="text-body">{m.admin_users_status_active()}</span>
								{/if}
							</td>
							<td class="px-3 py-3 whitespace-nowrap text-faint">{fmt.format(u.createdAt)}</td>
							<td class="px-3 py-3 text-right whitespace-nowrap">
								<a
									href={localizeHref(`/admin/users/${u.id}`)}
									class="text-primary-400 transition-colors hover:text-primary-300"
									>{m.admin_users_manage()}</a
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>
