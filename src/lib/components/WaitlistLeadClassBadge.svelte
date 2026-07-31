<script lang="ts">
	// The internal lead-class badge on /admin/waitlist (DAR-65). STAFF-ONLY: the class is decided
	// server-side by `classifyWaitlistLead` ($lib/server/waitlist-classify.ts) and this component only
	// paints the slug it is handed — it never classifies, and it must never be rendered on a public
	// page or pasted into an email.
	//
	// Priority A is styled loudest on purpose (filled + ringed, the only badge with a ring), because
	// the ticket's requirement is that an A lead is impossible to miss in a long list. The rest step
	// down in the same order the triage sort uses.
	import { waitlistLeadClassLabel } from '$lib/waitlist-labels';
	import type { WaitlistLeadClass } from '$lib/waitlist-qualification';

	let { leadClass }: { leadClass: WaitlistLeadClass } = $props();

	const TONE: Record<WaitlistLeadClass, string> = {
		'priority-a': 'bg-warning-500/25 text-warning-200 ring-1 ring-warning-500/50',
		'priority-b': 'bg-primary-500/15 text-primary-200',
		'priority-c': 'bg-surface-500/25 text-body',
		research: 'bg-secondary-500/15 text-secondary-200',
		investor: 'bg-tertiary-500/15 text-tertiary-200'
	};

	const label = $derived(waitlistLeadClassLabel[leadClass]());
</script>

<span class="badge whitespace-nowrap {TONE[leadClass]}">{label}</span>
