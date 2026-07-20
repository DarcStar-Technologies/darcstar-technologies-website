<script lang="ts">
	// The bordered inline error banner (role="alert") shared by the contact form (whole-form issues)
	// and the login form, so the copies can't drift. The caller supplies the message as children;
	// message SELECTION (the issue list vs an error code) stays with each caller.
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<p
	class="rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-400"
	role="alert"
>
	{@render children()}
</p>
