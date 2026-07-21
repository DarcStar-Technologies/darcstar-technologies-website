<script lang="ts">
	// Single-operator management (admin-only). Native server-action forms (work without JS): edit
	// details, change role, reset password, force logout, disable/enable, delete. Destructive/role/
	// password/session controls are hidden for your own account and owner accounts (data.manageable),
	// with an explanatory note instead. Delete is gated by a required "I understand" checkbox rather
	// than a JS confirm() (worker globals aren't typed for svelte-check).
	import Seo from '$lib/components/Seo.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import type { PageData } from './$types';

	type FormResult = {
		scope?: string;
		error?: string;
		ok?: boolean;
		values?: { name?: string; email?: string };
	} | null;
	let { data, form }: { data: PageData; form?: FormResult } = $props();

	const target = $derived(data.target);
	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

	function errorMessage(code: string | undefined): string {
		switch (code) {
			case 'email_taken':
				return m.admin_users_error_email_taken();
			case 'password_short':
				return m.admin_users_error_password_short();
			case 'missing':
				return m.admin_users_error_missing();
			case 'self':
				return m.admin_users_error_self();
			case 'owner':
				return m.admin_users_error_owner();
			default:
				return m.admin_users_error_generic();
		}
	}

	// Per-section feedback keyed by the action's `scope`.
	const errScope = $derived(form?.error ? form?.scope : null);
	const okScope = $derived(form?.ok ? form?.scope : null);

	// Repopulate the details form after a failed save; otherwise show the stored values.
	const nameValue = $derived(
		form?.scope === 'details' && form?.values ? (form.values.name ?? '') : target.name
	);
	const emailValue = $derived(
		form?.scope === 'details' && form?.values ? (form.values.email ?? '') : target.email
	);
</script>

<Seo
	title={m.admin_users_detail_page_title()}
	description={m.admin_users_detail_page_description()}
	noindex
/>

{#snippet okBanner(msg: string)}
	<p
		class="rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-sm text-success-400"
		role="status"
	>
		{msg}
	</p>
{/snippet}

<section class="max-w-3xl space-y-8">
	<div>
		<a
			href={localizeHref('/admin/users')}
			class="text-xs text-faint transition-colors hover:text-white">{m.admin_users_detail_back()}</a
		>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<h1 class="text-2xl font-medium tracking-tight break-all text-white">{target.email}</h1>
			{#if data.isSelf}
				<span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide text-faint"
					>{m.admin_users_badge_you()}</span
				>
			{:else if data.isOwner}
				<span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide text-faint"
					>{m.admin_users_badge_owner()}</span
				>
			{/if}
			{#if target.banned}
				<span
					class="rounded-full bg-error-500/15 px-2 py-0.5 text-[10px] tracking-wide text-error-400"
					>{m.admin_users_status_disabled()}</span
				>
			{/if}
		</div>
	</div>

	<!-- Details -->
	<div class="glass-card space-y-4 p-4 sm:p-6">
		<h2 class="text-lg font-medium text-white">{m.admin_users_detail_section_details()}</h2>
		{#if errScope === 'details'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
		{#if okScope === 'details'}{@render okBanner(m.admin_users_detail_saved())}{/if}
		<form method="post" action="?/updateDetails" class="space-y-4">
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
					>{m.admin_users_field_name_label()}</span
				>
				<input
					type="text"
					name="name"
					value={nameValue}
					required
					autocomplete="off"
					class={fieldClass}
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
					>{m.admin_users_field_email_label()}</span
				>
				<input
					type="email"
					name="email"
					value={emailValue}
					required
					autocomplete="off"
					class={fieldClass}
				/>
				<span class="mt-1 block text-xs text-faint">{m.admin_users_field_email_hint()}</span>
			</label>
			<button type="submit" class={submitButtonClass}>{m.admin_users_detail_save()}</button>
		</form>
	</div>

	{#if data.manageable}
		<!-- Role -->
		<div class="glass-card space-y-4 p-4 sm:p-6">
			<h2 class="text-lg font-medium text-white">{m.admin_users_detail_section_role()}</h2>
			<p class="text-sm text-faint">{m.admin_users_role_hint()}</p>
			{#if errScope === 'role'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
			{#if okScope === 'role'}{@render okBanner(m.admin_users_role_saved())}{/if}
			<form method="post" action="?/setRole" class="flex flex-wrap items-end gap-3">
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
						>{m.admin_users_field_role_label()}</span
					>
					<select name="role" class={fieldClass}>
						<option value="user" selected={target.role !== 'admin' && target.role !== 'operator'}
							>{m.admin_users_role_user()}</option
						>
						<option value="operator" selected={target.role === 'operator'}
							>{m.admin_users_role_operator()}</option
						>
						<option value="admin" selected={target.role === 'admin'}
							>{m.admin_users_role_admin()}</option
						>
					</select>
				</label>
				<button
					type="submit"
					class="glass-btn rounded-full px-4 py-2.5 text-sm font-medium text-white"
					>{m.admin_users_role_save()}</button
				>
			</form>
		</div>

		<!-- Reset password -->
		<div class="glass-card space-y-4 p-4 sm:p-6">
			<h2 class="text-lg font-medium text-white">{m.admin_users_detail_section_password()}</h2>
			{#if errScope === 'password'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
			{#if okScope === 'password'}{@render okBanner(m.admin_users_password_done())}{/if}
			<form method="post" action="?/resetPassword" class="space-y-4">
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
						>{m.admin_users_password_label()}</span
					>
					<input
						type="password"
						name="newPassword"
						required
						minlength="8"
						autocomplete="new-password"
						class={fieldClass}
					/>
					<span class="mt-1 block text-xs text-faint">{m.admin_users_password_hint()}</span>
				</label>
				<button
					type="submit"
					class="glass-btn rounded-full px-4 py-2.5 text-sm font-medium text-white"
					>{m.admin_users_password_submit()}</button
				>
			</form>
		</div>
	{:else}
		<p class="text-sm text-faint">
			{data.isSelf ? m.admin_users_note_self() : m.admin_users_note_owner()}
		</p>
	{/if}

	<!-- Sessions -->
	<div class="glass-card space-y-4 p-4 sm:p-6">
		<h2 class="text-lg font-medium text-white">{m.admin_users_detail_section_sessions()}</h2>
		{#if errScope === 'session'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
		{#if okScope === 'session'}{@render okBanner(m.admin_users_force_logout_done())}{/if}
		{#if data.sessions.length === 0}
			<p class="text-sm text-faint">{m.admin_users_sessions_none()}</p>
		{:else}
			<p class="text-sm text-emphasis">
				{m.admin_users_sessions_count({ count: data.sessions.length })}
			</p>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-hairline text-xs tracking-wide text-faint">
							<th class="px-3 py-2 font-medium whitespace-nowrap"
								>{m.admin_users_sessions_col_started()}</th
							>
							<th class="px-3 py-2 font-medium whitespace-nowrap"
								>{m.admin_users_sessions_col_expires()}</th
							>
							<th class="px-3 py-2 font-medium">{m.admin_users_sessions_col_ip()}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-hairline">
						{#each data.sessions as s (s.id)}
							<tr>
								<td class="px-3 py-2 whitespace-nowrap text-body">{fmt.format(s.createdAt)}</td>
								<td class="px-3 py-2 whitespace-nowrap text-faint">{fmt.format(s.expiresAt)}</td>
								<td class="px-3 py-2 text-faint">{s.ipAddress ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		{#if data.manageable && data.sessions.length > 0}
			<form method="post" action="?/forceLogout">
				<button
					type="submit"
					class="glass-btn rounded-full px-4 py-2 text-xs font-medium text-white"
					>{m.admin_users_force_logout()}</button
				>
			</form>
		{/if}
	</div>

	{#if data.manageable}
		<!-- Danger zone -->
		<div class="space-y-4 rounded-2xl border border-error-500/20 p-4 sm:p-6">
			<h2 class="text-lg font-medium text-error-400">{m.admin_users_detail_section_danger()}</h2>
			{#if errScope === 'status'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
			{#if okScope === 'status'}{@render okBanner(m.admin_users_status_updated())}{/if}
			{#if errScope === 'delete'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}

			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-faint">
					{target.banned ? m.admin_users_enable_hint() : m.admin_users_disable_hint()}
				</p>
				{#if target.banned}
					<form method="post" action="?/enable">
						<button
							type="submit"
							class="glass-btn rounded-full px-4 py-2 text-xs font-medium text-white"
							>{m.admin_users_enable()}</button
						>
					</form>
				{:else}
					<form method="post" action="?/disable">
						<button
							type="submit"
							class="rounded-full border border-error-500/40 px-4 py-2 text-xs font-medium text-error-400 transition-colors hover:bg-error-500/10"
							>{m.admin_users_disable()}</button
						>
					</form>
				{/if}
			</div>

			<form method="post" action="?/delete" class="space-y-3 border-t border-hairline pt-4">
				<p class="text-sm text-faint">{m.admin_users_delete_hint()}</p>
				<label class="flex items-center gap-2 text-sm text-body">
					<input type="checkbox" name="confirm" required class="accent-error-500" />
					{m.admin_users_delete_confirm_label()}
				</label>
				<button
					type="submit"
					class="rounded-full border border-error-500/50 bg-error-500/10 px-4 py-2 text-xs font-medium text-error-400 transition-colors hover:bg-error-500/20"
					>{m.admin_users_delete()}</button
				>
			</form>
		</div>
	{/if}
</section>
