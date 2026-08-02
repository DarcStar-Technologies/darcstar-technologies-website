<script lang="ts">
	// The brand lockup — the animated mark + the "DarcStar Technologies" wordmark
	// (with the charge-flow gradient on "Technologies"). Shared by the header and
	// footer. Renders the mark + wordmark as siblings meant to sit inside a flex
	// link that provides the gap and font sizing; pass `markClass` to size the mark
	// to its context (e.g. "size-20" in the header, "size-9" in the footer).
	import favicon from '$lib/assets/favicon.svg';

	let { markClass }: { markClass: string } = $props();
</script>

<!-- `shrink-0` is not decoration, and it is the mark's own property rather than the header's, which
     is why it is here and not in `markClass` (DAR-229). A flex item's `min-width` computes to `auto`
     — the content-based minimum — and this replaced element contributes NOTHING to it: measured, the
     header link's minimum comes out at 252.5px while its contents need 332.5 (mark 80 + gap 10 +
     "Technologies" 242.5). So the LINK is allowed to shrink under its own content, and what gives way
     is the wordmark text, which keeps its width and renders outside the box — silently, since nothing
     wraps and nothing overflows the bar. Holding the mark at its size puts it back into that minimum,
     so the link stops where its text stops and an overrun has to show up as bar overflow instead.
     Byte-identical in the footer at 280–1280px, and in the header at every width the bar actually
     fits — it changes the rendering only where the header was already failing, and there it changes
     which failure that is. -->
<img src={favicon} alt="" class="shrink-0 {markClass}" />
<span>DarcStar <span class="charge-flow">Technologies</span></span>
