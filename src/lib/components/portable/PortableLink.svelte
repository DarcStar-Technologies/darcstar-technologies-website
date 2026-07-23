<script lang="ts">
	// Renders the `link` annotation (blockContent's markDefs link: href + blank) around its wrapped
	// text. Registered as `components.marks.link`. External links (http/https) open in a new tab with
	// a safe `rel`; internal/relative links navigate in place. A CMS-authored href with an unexpected
	// scheme (`javascript:`, `data:`) is NOT rendered as a link — defense-in-depth, even though link
	// authors are trusted editors — the text still renders, just without the anchor.
	import type { Snippet } from 'svelte';
	import type { MarkComponentProps } from '@portabletext/svelte';

	let { portableText, children }: { portableText: MarkComponentProps; children: Snippet } =
		$props();
	const href = $derived((portableText.value as { href?: string } | undefined)?.href ?? '#');
	const external = $derived(/^https?:\/\//i.test(href));
	// Allow only http(s), mailto, and same-site relative/anchor hrefs.
	const safe = $derived(/^(https?:\/\/|mailto:|\/|#)/i.test(href));
</script>

{#if safe}
	<a
		{href}
		class="text-primary-500 underline underline-offset-4 transition-colors hover:text-primary-400"
		target={external ? '_blank' : undefined}
		rel={external ? 'noreferrer noopener' : undefined}>{@render children()}</a
	>
{:else}
	{@render children()}
{/if}
