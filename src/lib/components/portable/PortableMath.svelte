<script lang="ts">
	// Renders the Studio's `mathInline` / `mathBlock` nodes (DAR-106). Registered for BOTH types in
	// PortableBody — one component, because the only difference is the wrapper, and `displayMode` was
	// already decided server-side by `renderMathIn` ($lib/server/math.ts), which is where KaTeX runs.
	//
	// This file therefore carries no KaTeX JavaScript, only its stylesheet. The import is here rather
	// than in layout.css so Vite scopes the ~25 KB (and the fonts it references) to the two detail
	// routes that can contain math, instead of shipping it on every page of the site. A `.css`
	// SPECIFIER type-checks because src/vite-env.d.ts references vite/client — the Fontsource rule in
	// CLAUDE.md is about extension-less package specifiers, which TypeScript cannot resolve at all.
	import 'katex/dist/katex.min.css';
	import type { CustomBlockComponentProps } from '@portabletext/svelte';

	let { portableText }: { portableText: CustomBlockComponentProps } = $props();
	const value = $derived(portableText.value as { latex?: string; html?: string });
	// `latex` is typed as a string and can still arrive as something else — the Studio's validation is
	// a UI affordance an API write skips (DAR-70). The same guard as `typeset`'s, for the same reason:
	// this is the fallback path, so a throw here would take down the page that a broken equation was
	// only supposed to leave a mark on.
	const source = $derived(typeof value.latex === 'string' ? value.latex.trim() : '');
</script>

<!--
	KaTeX emits only spans and MathML, so the display form is valid in either position; the wrapper
	exists for the horizontal scroll a wide equation needs. `isInline` comes from the library rather
	than from `_type`, so the markup matches where the node actually sits.

	`{@html}` is safe by construction here — the string is KaTeX's own output, built under its default
	`trust: false`, which refuses every command that could emit a link or arbitrary attributes. It is
	never editor text; that path is the `{:else}` branch below, which Svelte escapes.
-->
{#if value.html}
	{#if portableText.isInline}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html value.html}
	{:else}
		<div class="my-6 overflow-x-auto">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html value.html}
		</div>
	{/if}
{:else if source}
	<!--
		Nothing rendered, but the editor wrote something: show the source. Silence is the failure this
		ticket exists to remove, so an equation KaTeX could not typeset at all degrades to visible,
		obviously-untypeset text rather than to a gap nobody can see. `not-prose` keeps Tailwind
		Typography from wrapping it in decorative backticks.
	-->
	<code class="not-prose font-mono text-sm text-error-400">{source}</code>
{/if}
