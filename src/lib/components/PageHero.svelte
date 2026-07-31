<script lang="ts">
	// The one hero pattern every page uses (see CLAUDE.md): eyebrow → #helix-slot (CosmicBackdrop
	// centres the RGB helix there) → heading + optional lede inside a frosted glass-panel. Extracted
	// so the /news, /research, /people surfaces (and their detail pages) never drift from the
	// homepage/about hero. Copy comes in as already-resolved strings (Paraglide `m.*()` or CMS data),
	// so this component holds no literal copy of its own.
	interface Props {
		eyebrow: string;
		heading: string;
		/** Optional word rendered with the `charge-flow` RGB gradient — the brand emphasis on the
		 * hero headings. Omit for detail pages, whose heading is arbitrary CMS copy. */
		emphasis?: string;
		/** Which side of the heading the emphasis sits on. Trailing is the common case ("News &
		 * _notes_", "Our _team_"); `/about` leads with it ("_Provable_ safety for autonomous
		 * systems."), which is the ONLY thing that kept that page on a hand-rolled copy of this
		 * component (DAR-218). A discrete content-shape choice, deliberately not a style knob —
		 * spacing and padding stay the component's own, so a caller wanting a roomier gap adds it
		 * outside rather than configuring the hero. */
		emphasisPosition?: 'leading' | 'trailing';
		lead?: string;
	}
	let { eyebrow, heading, emphasis, emphasisPosition = 'trailing', lead }: Props = $props();
</script>

<section class="-mt-10 flex flex-col items-center px-6 pt-6 pb-8 text-center sm:pt-8">
	<p class="eyebrow-hero">{eyebrow}</p>

	<!-- The twisting triple helix centres in this gap; CosmicBackdrop measures #helix-slot to place
	     and SIZE it (its height caps the helix amplitude), so keep the height even though the panel
	     below overlaps it — on content pages the panel rises onto the helix's lower arcs (negative
	     margin) instead of sitting fully below, reclaiming vertical space while the upper arcs stay
	     visible above the panel. The homepage/about keep the full below-the-helix hero. -->
	<div id="helix-slot" class="h-6 min-[360px]:h-[var(--helix-slot-h)]"></div>

	<div
		class="glass-card mx-auto w-full max-w-3xl px-8 py-10 text-center min-[360px]:-mt-[var(--helix-pull)] sm:px-10 sm:py-12"
	>
		<h1 class="text-4xl font-medium tracking-tight text-balance text-white sm:text-5xl">
			<!-- Both joins have to be written out, because literal whitespace at an {#if} boundary is
			     trimmed by the compiler — that is what would render "News &notes" (and "Provablesafety").
			     They are deliberately DIFFERENT characters:
			       trailing → `&nbsp;`, so a short emphasis word ("notes", "team") can't be orphaned
			                  onto a line of its own under a heading that wraps;
			       leading  → a real breaking space, because the emphasis is followed by the whole
			                  heading rather than preceded by it. Binding them would make "Provable
			                  safety" one unbreakable 15-character run, which at text-4xl overflows
			                  the card on a 360px screen instead of wrapping.
			     An expression renders a space that survives the trim, and it is the ONLY thing that does:
			     `&#32;` looks like the tidy answer and is not — Svelte decodes the entity to a plain
			     space and then trims it exactly as if it had been typed (measured; the spec below goes
			     red). `&nbsp;` survives only because U+00A0 is not ASCII whitespace, which is the very
			     property that makes it wrong here. Hence the rule exemption rather than a rewrite: the
			     mustache is load-bearing, and `svelte/no-useless-mustaches` cannot see that. -->
			<!-- A block disable rather than `disable-next-line`: prettier wraps this single logical line
			     across four physical ones and chooses where, so a line-scoped exemption silently drifts
			     off the mustache it was placed for. Re-enabled immediately below, so the exemption
			     covers the heading and nothing after it. -->
			<!-- eslint-disable svelte/no-useless-mustaches -->
			{#if emphasis && emphasisPosition === 'leading'}<span class="charge-flow">{emphasis}</span
				>{' '}{/if}{heading}{#if emphasis && emphasisPosition === 'trailing'}&nbsp;<span
					class="charge-flow">{emphasis}</span
				>{/if}
			<!-- eslint-enable svelte/no-useless-mustaches -->
		</h1>
		{#if lead}
			<p class="mx-auto mt-6 max-w-2xl text-base text-body sm:text-lg">{lead}</p>
		{/if}
	</div>
</section>
