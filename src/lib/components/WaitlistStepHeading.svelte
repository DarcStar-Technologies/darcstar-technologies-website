<script lang="ts">
	// The eyebrow + heading + lede every /waitlist step opens with — step 1 on the page itself and
	// each of the optional steps. Five copies differing only in two message keys, so the eyebrow and
	// the type scale now have one home.
	import { m } from '$lib/paraglide/messages.js';

	let { heading, lead }: { heading: string; lead: string } = $props();
</script>

<p class="eyebrow-panel">{m.waitlist_page_eyebrow()}</p>
<h1 class="mt-3 text-3xl font-medium tracking-tight text-white">{heading}</h1>
<p class="mt-2 text-sm text-body">{lead}</p>
