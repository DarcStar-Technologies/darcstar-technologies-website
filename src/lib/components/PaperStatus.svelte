<script module lang="ts">
	// The pill base shared by the paper meta rail's chips — exported so PaperOrigin's chips can't
	// drift from PaperStatus's (the ContactFields `fieldClass` convention). Callers append their
	// border/text color tokens.
	export const pillClass =
		'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium';
</script>

<script lang="ts">
	// Publication-status pill for a Sanity `paper` (draft | preprint | toAppear | published). Label
	// comes from Paraglide; `published` gets the brand accent, the rest stay neutral. Shared by the
	// /research list + detail so the status never renders inconsistently.
	import { m } from '$lib/paraglide/messages.js';

	let { status }: { status: 'draft' | 'preprint' | 'toAppear' | 'published' | null } = $props();

	const label = $derived(
		status === 'draft'
			? m.research_status_draft()
			: status === 'preprint'
				? m.research_status_preprint()
				: status === 'toAppear'
					? m.research_status_toappear()
					: status === 'published'
						? m.research_status_published()
						: null
	);
	const tone = $derived(
		status === 'published' ? 'border-primary-500/40 text-primary-400' : 'border-hairline text-muted'
	);
</script>

{#if label}
	<span class="{pillClass} {tone}">
		{label}
	</span>
{/if}
