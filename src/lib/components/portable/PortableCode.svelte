<script lang="ts">
	// Renders a `code` block inside Portable Text `body` (from @sanity/code-input: code/language/
	// filename). Registered as `components.types.code`. Plain <pre><code> for now — no client-side
	// syntax highlighter (keeps the bundle lean); language-aware highlighting is a later enhancement.
	import type { CustomBlockComponentProps } from '@portabletext/svelte';
	import type { Code } from '$lib/sanity/types';

	let { portableText }: { portableText: CustomBlockComponentProps } = $props();
	const value = $derived(portableText.value as Code);
</script>

{#if value.code}
	<figure class="not-prose my-6 overflow-hidden rounded-xl border border-hairline">
		{#if value.filename}
			<figcaption
				class="border-b border-hairline bg-black/20 px-4 py-2 font-mono text-xs text-muted"
			>
				{value.filename}
			</figcaption>
		{/if}
		<pre class="overflow-x-auto bg-black/20 p-4 font-mono text-sm text-body"><code
				>{value.code}</code
			></pre>
	</figure>
{/if}
