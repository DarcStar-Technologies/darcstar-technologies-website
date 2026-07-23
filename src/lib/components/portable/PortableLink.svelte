<script lang="ts">
	// Renders the `link` annotation (blockContent's markDefs link: href + blank) around its wrapped
	// text. Registered as `components.marks.link`. External links (http/https) open in a new tab with
	// a safe `rel`; internal/relative links navigate in place.
	import type { Snippet } from 'svelte';
	import type { MarkComponentProps } from '@portabletext/svelte';

	let { portableText, children }: { portableText: MarkComponentProps; children: Snippet } =
		$props();
	const href = $derived((portableText.value as { href?: string } | undefined)?.href ?? '#');
	const external = $derived(/^https?:\/\//i.test(href));
</script>

<a
	{href}
	class="text-primary-500 underline underline-offset-4 transition-colors hover:text-primary-400"
	target={external ? '_blank' : undefined}
	rel={external ? 'noreferrer noopener' : undefined}>{@render children()}</a
>
