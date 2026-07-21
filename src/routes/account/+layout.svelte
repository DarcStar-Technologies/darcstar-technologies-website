<script lang="ts">
	// Shared shell for the end-user account portal (#96). Renders the starfield backdrop once plus
	// the signed-in-as + sign-out controls — same chrome idiom as the admin shell, minus the roster
	// sub-nav (an end-user has a single page). The page renders its own <Seo> + <h1> + content below.
	import type { Snippet } from 'svelte';
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<CosmicBackdrop />

<div class="mb-8 flex flex-wrap items-center justify-between gap-4">
	<p class="eyebrow text-xs tracking-[0.25em]">{m.account_eyebrow()}</p>
	<div class="flex items-center gap-3">
		<span class="text-xs text-faint">{m.account_signed_in_as({ email: data.email })}</span>
		<form method="post" action={localizeHref('/logout')}>
			<button type="submit" class="glass-btn rounded-full px-4 py-2 text-xs font-medium text-white">
				{m.account_signout()}
			</button>
		</form>
	</div>
</div>

{@render children()}
