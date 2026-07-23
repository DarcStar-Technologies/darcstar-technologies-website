<script lang="ts">
	// End-user account portal (#96). Native server-action forms (work without JS): update display
	// name, change password. Below that, a read-only list of THIS account's own contact submissions
	// (scoped to locals.user.id in +page.server.ts). Same CosmicBackdrop + glass aesthetic as the
	// rest of the site (backdrop is in the layout). Distinct from the staff /admin surface.
	import Seo from '$lib/components/Seo.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { WELCOME_FLAG, isWelcome } from '$lib/account-welcome';
	import { m } from '$lib/paraglide/messages.js';
	import { interestLabel } from '$lib/contact-interest-labels';
	import type { Interest } from '$lib/contact-interests';
	import { fieldClass, submitButtonClass } from '$lib/components/ContactFields.svelte';
	import type { PageData } from './$types';

	type FormResult = { scope?: string; error?: string; ok?: boolean; name?: string } | null;
	let { data, form }: { data: PageData; form?: FormResult } = $props();

	// One-time "email verified — welcome" banner (#106). Better Auth's verify-email flow redirects the
	// freshly-verified, auto-signed-in user here with the welcome flag (the callbackURL the signup/resend
	// actions pass — account-welcome.ts owns both ends). Capture the flag ONCE into state at init (so SSR
	// and hydration agree), then strip the marker from the URL below — the banner stays for this view but
	// a reload/back won't re-show it.
	let showWelcome = $state(isWelcome(page.url));
	$effect(() => {
		if (page.url.searchParams.has(WELCOME_FLAG)) replaceState(page.url.pathname, {});
	});

	const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

	// Per-section feedback keyed by the action's `scope` (mirrors admin/users/[id]).
	const errScope = $derived(form?.error ? form?.scope : null);
	const okScope = $derived(form?.ok ? form?.scope : null);

	// Repopulate the name field after a failed save; otherwise show the stored value (from the
	// account layout load).
	const nameValue = $derived(
		form?.scope === 'profile' && 'name' in form ? (form.name ?? '') : data.name
	);

	function errorMessage(code: string | undefined): string {
		switch (code) {
			case 'missing':
				return m.account_error_missing();
			case 'password_short':
				return m.account_error_password_short();
			case 'invalid':
				return m.account_error_password_invalid();
			default:
				return m.account_error_generic();
		}
	}

	// Stored interest is a raw slug (or null). Map to its localized label; fall back to the raw value
	// for an unknown slug, and an em-dash when absent.
	function labelFor(slug: string | null): string {
		if (!slug) return '—';
		return interestLabel[slug as Interest]?.() ?? slug;
	}
</script>

<Seo title={m.account_page_title()} description={m.account_page_description()} noindex />

{#snippet okBanner(msg: string)}
	<p
		class="rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-sm text-success-400"
		role="status"
	>
		{msg}
	</p>
{/snippet}

<section class="max-w-3xl space-y-8">
	{#if showWelcome}{@render okBanner(m.account_welcome_verified())}{/if}

	<header>
		<h1 class="text-3xl font-medium tracking-tight text-white">{m.account_heading()}</h1>
		<p class="mt-2 text-sm text-body">{m.account_lead()}</p>
	</header>

	<!-- Profile: display name -->
	<div class="glass-card space-y-4 p-4 sm:p-6">
		<h2 class="text-lg font-medium text-white">{m.account_section_profile()}</h2>
		<p class="text-sm text-faint">{m.account_email_locked({ email: data.email })}</p>
		{#if errScope === 'profile'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
		{#if okScope === 'profile'}{@render okBanner(m.account_profile_saved())}{/if}
		<form method="post" action="?/updateName" class="space-y-4">
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
					>{m.account_field_name_label()}</span
				>
				<input
					type="text"
					name="name"
					value={nameValue}
					required
					autocomplete="name"
					class={fieldClass}
				/>
			</label>
			<button type="submit" class={submitButtonClass}>{m.account_profile_save()}</button>
		</form>
	</div>

	<!-- Change password -->
	<div class="glass-card space-y-4 p-4 sm:p-6">
		<h2 class="text-lg font-medium text-white">{m.account_section_password()}</h2>
		{#if errScope === 'password'}<ErrorBanner>{errorMessage(form?.error)}</ErrorBanner>{/if}
		{#if okScope === 'password'}{@render okBanner(m.account_password_done())}{/if}
		<form method="post" action="?/changePassword" class="space-y-4">
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
					>{m.account_field_current_password_label()}</span
				>
				<input
					type="password"
					name="currentPassword"
					required
					autocomplete="current-password"
					class={fieldClass}
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-xs font-medium tracking-wide text-body"
					>{m.account_field_new_password_label()}</span
				>
				<input
					type="password"
					name="newPassword"
					required
					minlength="8"
					autocomplete="new-password"
					class={fieldClass}
				/>
				<span class="mt-1 block text-xs text-faint">{m.account_password_hint()}</span>
			</label>
			<button type="submit" class={submitButtonClass}>{m.account_password_submit()}</button>
		</form>
	</div>

	<!-- Your messages (read-only) -->
	<div class="glass-card space-y-4 p-4 sm:p-6">
		<h2 class="text-lg font-medium text-white">{m.account_section_messages()}</h2>
		{#if data.messages.length === 0}
			<p class="px-2 py-8 text-center text-sm text-faint">{m.account_messages_empty()}</p>
		{:else}
			<p class="text-sm text-emphasis">
				{m.account_messages_count({ count: data.messages.length })}
			</p>
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-hairline text-xs tracking-wide text-faint">
							<th class="px-3 py-2 font-medium whitespace-nowrap"
								>{m.account_messages_col_sent()}</th
							>
							<th class="px-3 py-2 font-medium">{m.account_messages_col_interest()}</th>
							<th class="px-3 py-2 font-medium">{m.account_messages_col_message()}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-hairline">
						{#each data.messages as msg (msg.id)}
							<tr class="align-top">
								<td class="px-3 py-3 whitespace-nowrap text-faint">{fmt.format(msg.createdAt)}</td>
								<td class="px-3 py-3 whitespace-nowrap text-body">{labelFor(msg.interest)}</td>
								<td class="max-w-md px-3 py-3 text-body">
									<span class="block break-words whitespace-pre-wrap">{msg.message}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>
