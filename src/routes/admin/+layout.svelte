<script lang="ts">
	// Shared shell for the gated admin area (#69). Renders the starfield backdrop once, a section
	// sub-nav (Submissions | Users — Users only for roster admins), and the signed-in-as + sign-out
	// controls, so both /admin and /admin/users inherit identical chrome. Each page renders its own
	// <Seo> + <h1> + content below.
	import type { Snippet } from 'svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import { page } from '$app/state';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Locale-agnostic active-tab checks (paths localize to /es/admin/...).
	const onUsers = $derived(page.url.pathname.includes('/admin/users'));
	const onAudit = $derived(page.url.pathname.includes('/admin/audit'));
	const onWaitlist = $derived(page.url.pathname.includes('/admin/waitlist'));
	const onSubmissions = $derived(!onUsers && !onAudit && !onWaitlist);

	const tabBase =
		'rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500';
	const tabActive = 'bg-white/10 text-white';
	const tabIdle = 'text-faint hover:text-white';
</script>

<CosmicBackdrop />

<div class="mb-8 flex flex-wrap items-center justify-between gap-4">
	<div class="flex flex-wrap items-center gap-4">
		<p class="eyebrow text-xs tracking-[0.25em]">{m.admin_eyebrow()}</p>
		<nav class="flex items-center gap-1" aria-label={m.admin_nav_label()}>
			<a
				href={localizeHref('/admin')}
				aria-current={onSubmissions ? 'page' : undefined}
				class="{tabBase} {onSubmissions ? tabActive : tabIdle}">{m.admin_nav_submissions()}</a
			>
			<a
				href={localizeHref('/admin/waitlist')}
				aria-current={onWaitlist ? 'page' : undefined}
				class="{tabBase} {onWaitlist ? tabActive : tabIdle}">{m.admin_nav_waitlist()}</a
			>
			<a
				href={localizeHref('/admin/audit')}
				aria-current={onAudit ? 'page' : undefined}
				class="{tabBase} {onAudit ? tabActive : tabIdle}">{m.admin_nav_audit()}</a
			>
			{#if data.isAdmin}
				<a
					href={localizeHref('/admin/users')}
					aria-current={onUsers ? 'page' : undefined}
					class="{tabBase} {onUsers ? tabActive : tabIdle}">{m.admin_nav_users()}</a
				>
			{/if}
		</nav>
	</div>
	<div class="flex items-center gap-3">
		<span class="text-xs text-faint">{m.admin_signed_in_as({ email: data.user.email })}</span>
		<form method="post" action={localizeHref('/logout')}>
			<button type="submit" class="glass-btn rounded-full px-4 py-2 text-xs font-medium text-white">
				{m.admin_signout()}
			</button>
		</form>
	</div>
</div>

{@render children()}
