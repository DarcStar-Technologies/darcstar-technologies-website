<script module lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { ContributionKind } from '$lib/research-filters';

	// Kind → label, exported for the same reason PaperStatus exports `pillClass`: /research's
	// Contribution select needs these strings too, and a second copy of the mapping there would be
	// free to drift from the pill's (the ContactFields `fieldClass` convention).
	//
	// It stores `m.x`, NOT `m.x()`. This object is built once per module — which on the server means
	// once per worker, shared by every request — so resolving the strings here would freeze whatever
	// locale happened to be active at import time and serve it to everyone. Holding the function
	// defers `getLocale()` to the call, where Paraglide's url strategy can answer per request.
	//
	// `Record<ContributionKind, …>` is the point of the shape: a kind added to CONTRIBUTION_KINDS
	// without a label here is a COMPILE error, so the vocabulary and its labels cannot drift apart.
	//
	// That is one link in a chain, not the whole guard, and it is worth being precise about which is
	// which. A kind added in the STUDIO is caught at the two `<PaperContribution>` mount points, where
	// the widened `Paper['contribution']` stops being assignable to `ContributionKind` (measured: 2
	// `pnpm check` errors). This `Record` then catches the follow-up — adding it to CONTRIBUTION_KINDS
	// and forgetting the label.
	const LABELS: Record<ContributionKind, () => string> = {
		conceptual: m.research_contribution_conceptual,
		formal: m.research_contribution_formal,
		empirical: m.research_contribution_empirical,
		engineering: m.research_contribution_engineering
	};

	/** The reader-facing label for a contribution kind, verbatim from the Studio's own radio list. */
	export function contributionLabel(kind: ContributionKind): string {
		return LABELS[kind]();
	}
</script>

<script lang="ts">
	// Contribution-kind pill for a Sanity `paper` (DAR-162) — what KIND of contribution the entry is,
	// which is a different axis from `PaperStatus`'s publication stage. The two sit side by side and
	// answer different questions: "Preprint" says where it is in the world, "Conceptual framework"
	// says what it is. The shelf carried only the first, so DarcStar's one first-party paper — a
	// theorem-only disclosure — presented exactly like the rigorous formal-methods material.
	//
	// NEUTRAL tone, per the paper-rail charge mapping in docs/sanity.md: R/G/B are spoken for by
	// topic / commentary / actionable, and a kind is a descriptor rather than a badge. It shares
	// PaperStatus's `pillClass` so pill geometry can't drift from the rest of the rail.
	//
	// Renders nothing for an unset OR unrecognised value, matching PaperStatus. That is load-bearing
	// in one direction and merely tidy in the other: the field is optional with no initialValue, so
	// 17 of 18 papers legitimately have no kind and must show no pill; and an unknown value can only
	// mean the Studio's enum grew without CONTRIBUTION_KINDS following, where a blank beats a raw
	// `conceptual`-style token on a public page.
	import { pillClass } from '$lib/components/PaperStatus.svelte';

	let { contribution }: { contribution: ContributionKind | null } = $props();

	// `LABELS[...]` rather than `contributionLabel(...)`: the prop is TYPED as a known kind and can
	// still arrive as anything, since it comes from the CMS through a generated union (the
	// `authorOptionLabel` lesson — a required field in the Studio is a UI affordance an API write
	// skips). Indexing and testing for undefined is what makes the unknown-value case a blank pill
	// instead of a TypeError that takes the whole card down.
	const label = $derived(contribution ? LABELS[contribution]?.() : null);
</script>

{#if label}
	<span class="{pillClass} border-hairline text-muted">
		{label}
	</span>
{/if}
