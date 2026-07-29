<script lang="ts">
	// Venue · publication date — the paper meta rail's third slot, beside PaperStatus and
	// PaperOrigin. /research and /research/[slug] carried byte-identical copies of this markup and
	// BOTH rendered `Zenodo·February 4, 2026` (DAR-153): the `·` sat alone on its own line inside an
	// `{#if}`, and Svelte trims whitespace at a block boundary — here on both sides at once, so
	// nothing separated the two values. Extracted rather than patched twice, so a third surface
	// cannot reintroduce it and the behaviour has one spec instead of two.
	//
	// `&nbsp;` on BOTH sides, which is where this differs from /people/[slug] and /news/[slug]: those
	// need only a leading one, because the space AFTER their separator is interior to its block and
	// survives. Here that space would be the block's trailing whitespace and is trimmed, so a
	// leading-only fix leaves `Zenodo ·February 4, 2026` — half the bug, and the half that looks
	// deliberate. Entities are not ASCII whitespace, so re-wrapping this block over three lines
	// cannot bring the defect back (mutation-checked, since that is exactly how it arrived).
	//
	// The `aria-hidden` on the dot is NEW — neither /research page had it, though the site's three
	// other separators (Footer, /news, /people/[slug]) all do. It is the one change here that is not
	// whitespace: the dot is decoration, so a screen reader should hear "Zenodo February 4, 2026"
	// rather than a punctuation name, and it should not depend on which surface you are reading.
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';

	let { venue, publishedDate }: { venue: string | null; publishedDate: string | null } = $props();

	// Gate on what will RENDER, never on the raw field. `formatDate` returns '' for a null, empty or
	// unparseable value, so branching the separator on `publishedDate` itself puts a dangling
	// `Zenodo ·` on the card whenever a write bypasses the Studio's date widget — the original markup
	// did exactly that, and it took writing the spec to see it. Same rule as /news/[slug]'s
	// related-papers section (DAR-148): the condition and the content must read the same value.
	const date = $derived(formatDate(publishedDate, getLocale()));
</script>

{#if venue || date}
	<span class="text-xs text-muted"
		>{#if venue}{venue}{/if}{#if venue && date}&nbsp;<span aria-hidden="true">·</span
			>&nbsp;{/if}{date}</span
	>
{/if}
