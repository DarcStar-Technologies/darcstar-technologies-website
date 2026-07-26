<script lang="ts">
	// The waitlist flow's terminal screen (DAR-64) — reached by every path: the full flow, a Skip at
	// any step, and both step-4 branches. It reuses the shared `ContactSuccess` shell so the check
	// badge and type scale can't drift from the contact form's confirmation.
	//
	// ONE call to action, and WHICH one is a SERVER decision: `confirmationCtaFor`
	// ($lib/server/waitlist-flow.ts) picks it from the same flow state that routed the steps, and the
	// terminal step's response hands the resolved value over. Nothing here re-derives it from form
	// values — that's the point of the prop being a bare slug.
	//
	// NOTHING THE VISITOR ANSWERED IS ECHOED BACK. The value/budget/deployment answers are
	// internal-only (DAR-58); this screen shows fixed copy plus a link, so there is no path by which
	// one could reach it.
	import { onMount } from 'svelte';
	import ContactSuccess from './ContactSuccess.svelte';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { waitlistCtaLabel } from '$lib/waitlist-labels';
	import type { WaitlistCta } from '$lib/waitlist-qualification';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';

	let { cta }: { cta: WaitlistCta } = $props();

	// Where each variant points. All four are real links — the `pilot` one is the site's /contact page,
	// which JS upgrades into the global modal below.
	const CTA_HREF: Record<WaitlistCta, string> = {
		pilot: '/contact',
		evidence: '/evidence',
		research: '/research',
		home: '/'
	};

	const href = $derived(localizeHref(CTA_HREF[cta]));
	// `$derived` so the label re-resolves on locale change (the accessors are $state-backed Paraglide
	// messages).
	const label = $derived(waitlistCtaLabel[cta]());

	// False on the server and until hydration — the same enhancement gate the step-4A reveals use. It
	// guards only the ARIA promise: without JS this really is a link to /contact, so announcing a
	// dialog would be a lie.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	const opensDialog = $derived(mounted && cta === 'pilot');

	/**
	 * Upgrade the pilot CTA from "navigate to /contact" to "open the contact modal in place", so a lead
	 * who just finished the flow doesn't lose the confirmation. Progressive enhancement, not a gate:
	 * with JS off this handler never runs and the anchor navigates normally.
	 *
	 * Modifier and non-primary clicks are left to the browser — "open in a new tab" has to keep
	 * working on a link that looks like one.
	 */
	function openContactDialog(event: MouseEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		contactDialog.show();
		// DAR-66 (funnel analytics) fires `evaluation_conversation_requested` HERE — this is the single
		// point in the flow where a qualified lead asks for a conversation. The site has no analytics
		// transport yet, so the event is deliberately not faked in the meantime.
	}
</script>

<ContactSuccess title={m.waitlist_success_title()} body={m.waitlist_success_body()}>
	{#snippet action()}
		<div class="mt-6 flex justify-center">
			<a
				{href}
				onclick={cta === 'pilot' ? openContactDialog : undefined}
				aria-haspopup={opensDialog ? 'dialog' : undefined}
				class="glass-btn btn-pill">{label}</a
			>
		</div>
	{/snippet}
</ContactSuccess>
