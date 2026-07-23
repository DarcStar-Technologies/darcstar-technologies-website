<script lang="ts">
	// The one hero pattern every page uses (see CLAUDE.md): eyebrow → #helix-slot (CosmicBackdrop
	// centres the RGB helix there) → heading + optional lede inside a frosted glass-panel. Extracted
	// so the /news, /research, /people surfaces (and their detail pages) never drift from the
	// homepage/about hero. Copy comes in as already-resolved strings (Paraglide `m.*()` or CMS data),
	// so this component holds no literal copy of its own.
	interface Props {
		eyebrow: string;
		heading: string;
		/** Optional trailing word rendered with the `charge-flow` RGB gradient — the brand emphasis
		 * on the homepage/about heroes. Omit for detail pages, whose heading is arbitrary CMS copy. */
		emphasis?: string;
		lead?: string;
	}
	let { eyebrow, heading, emphasis, lead }: Props = $props();
</script>

<section class="-mt-10 flex flex-col items-center px-6 pt-6 pb-8 text-center sm:pt-8">
	<p class="eyebrow text-sm tracking-[0.3em]">{eyebrow}</p>

	<!-- The twisting triple helix centres in this gap; CosmicBackdrop measures #helix-slot to place
	     and SIZE it (its height caps the helix amplitude), so keep the height even though the panel
	     below overlaps it — on content pages the panel rises onto the helix's lower arcs (negative
	     margin) instead of sitting fully below, reclaiming vertical space while the upper arcs stay
	     visible above the panel. The homepage/about keep the full below-the-helix hero. -->
	<div id="helix-slot" class="h-6 min-[360px]:h-[min(25vw,19rem)]"></div>

	<div
		class="glass-card mx-auto w-full max-w-3xl px-8 py-10 text-center min-[360px]:-mt-[min(23vw,17.5rem)] sm:px-10 sm:py-12"
	>
		<h1 class="text-4xl font-medium tracking-tight text-balance text-white sm:text-5xl">
			<!-- `&nbsp;` forces the space between lead + emphasis: a normal space (leading whitespace of
			     the {#if} block) is trimmed by the compiler, which would render "News &notes". -->
			{heading}{#if emphasis}&nbsp;<span class="charge-flow">{emphasis}</span>{/if}
		</h1>
		{#if lead}
			<p class="mx-auto mt-6 max-w-2xl text-base text-body sm:text-lg">{lead}</p>
		{/if}
	</div>
</section>
