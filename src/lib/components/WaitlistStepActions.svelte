<script lang="ts">
	// The Continue / "Skip for now" pair every optional waitlist step ends with (steps 2, 3, 4A, 4B).
	//
	// Extracted because the markup was byte-identical in all four and the ORDER is load-bearing:
	// Continue must come FIRST in the DOM so it's the form's default submitter — pressing Enter
	// continues, it never accidentally skips — while CSS `order` puts it on the right on wider
	// screens. Four copies of that rule was four chances to break it.
	//
	// Both buttons submit the same form; the server reads `intent` to tell them apart (Continue
	// writes the answers, Skip persists nothing and terminates the flow).
	//
	// The prop is typed STRUCTURALLY rather than as a union of the four form instances, so a fifth
	// step would need no change here: anything with an `intent` submit field and a `pending` count
	// fits.
	import type { RemoteFormField } from '@sveltejs/kit';
	import { m } from '$lib/paraglide/messages.js';

	let {
		form
	}: {
		form: { fields: { intent: RemoteFormField<string> }; pending: number };
	} = $props();
</script>

<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
	<button
		{...form.fields.intent.as('submit', 'continue')}
		disabled={!!form.pending}
		class="glass-btn order-1 w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-2 sm:w-auto"
	>
		{m.waitlist_flow_continue()}
	</button>
	<button
		{...form.fields.intent.as('submit', 'skip')}
		disabled={!!form.pending}
		class="order-2 rounded-full px-6 py-3 text-sm font-medium text-subtle transition-colors hover-focus:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:order-1"
	>
		{m.waitlist_flow_skip()}
	</button>
</div>
