<script lang="ts">
	// The brand lockup — the animated mark + the "DarcStar Technologies" wordmark
	// (with the charge-flow gradient on "Technologies"). Shared by the header and
	// footer. Renders the mark + wordmark as siblings meant to sit inside a flex
	// link that provides the gap and font sizing; pass `markClass` to size the mark
	// to its context (e.g. "size-20" in the header, "size-9" in the footer).
	import favicon from '$lib/assets/favicon.svg';

	let { markClass }: { markClass: string } = $props();
</script>

<img src={favicon} alt="" class={markClass} />
<span>DarcStar <span class="charge-flow">Technologies</span></span>
