<script lang="ts">
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import Icon from '$lib/components/Icon.svelte';
	import { inlineLinkClass, mutedLinkClass } from '$lib/styles';
	import {
		CFC_KERNEL_LATENCY,
		DOMAINS,
		REALTIME_MULTIPLE,
		THEOREMS_CHECKED,
		THEOREMS_COMPLETE
	} from '$lib/evidence';

	// Domains the one engine has actually shipped into — the shared spine in $lib/evidence.ts
	// (DAR-43), so the rows here, the "domains running end-to-end" figure, and the /evidence
	// domains card all iterate one list and can never drift. What the count means is stated
	// under the rows (section_domains_scope, DAR-46) rather than left to the reader — the
	// review read the bare count as possibly meaning pilots or customer deployments.
	// `$derived` (not a plain const): the visible copy is Paraglide messages, so the array
	// re-resolves if a locale switcher is ever added — getLocale() is $state-backed
	// (src/lib/paraglide.svelte.ts). On SSR it evaluates exactly once.
	const domains = $derived(DOMAINS.map((d) => ({ n: d.name(), d: d.home() })));

	// Stats row — REAL, verifiable numbers only (issue #13), each scoped on /evidence (DAR-43).
	// Every figure comes from $lib/evidence.ts, the single source the /evidence cards read too:
	// latency is measured, the multiple is derived from it (10 ms budget ÷ latency), and the
	// theorem figures are the conformance-registry counts (the old "150" was the Layer-1 catalog
	// size, not a proven count — see docs/evidence.md). Only the LABELS are messages — the values
	// stay as data: they're en-formatted figures, not translatable prose (a real `es` would run
	// them through Intl.NumberFormat, e.g. "13.000×"), and the numbers must read identically
	// across locales. THEOREMS_CHECKED rides IN the theorem label as a `{checked}` param for the
	// same reason `pillar_realtime_body` takes its figures that way: still data, still one source.
	//
	// The headline theorem figure is THEOREMS_COMPLETE, not THEOREMS_CHECKED (DAR-117). Leading
	// with the larger number put the least-qualified figure in the biggest type — most of the
	// checked corpus rests on local axioms awaiting discharge, and a formal-methods reviewer reads
	// a bare total that way. The complete cluster is the stronger claim anyway (zero local axioms,
	// both provers), so the readout leads with it and carries the total as its denominator. Both
	// numbers stay on screen; only which one is the headline changed. "complete" is a term of art,
	// so section_proven_body defines it further down the page — DAR-46's rule, and the reason
	// evidence-disclosure.spec.ts pins the label and that definition together.
	//
	// The long label wraps this row to two lines at desktop widths, and that is accepted rather
	// than unnoticed: measured in a real browser, the row fits four across at 1440px only while
	// the widest label stays around 24 characters — the old "theorems machine-checked" sat exactly
	// at that edge. Every shorter phrasing costs a word that is doing work. Dropping "theorems"
	// leaves the unit unnamed; dropping "machine-checked" leaves a bare "of 219" that reads as the
	// size of the whole corpus, which is the catalog total — a figure this site deliberately never
	// publishes (docs/evidence.md), so the cheap-looking trim would quietly imply the one number
	// the IP boundary exists to withhold. Capping the label width doesn't buy the row back either
	// — measured, 12rem still wraps (just less tall) and 11rem is worse, three rows, because the
	// cap wraps the other labels too. `flex-wrap` + `gap-y-4` on the container is a designed
	// state, and it already wraps at tablet widths; the honest label wins the tie.
	const readouts = $derived([
		{ v: CFC_KERNEL_LATENCY, l: m.readout_cfc_label() },
		{ v: REALTIME_MULTIPLE, l: m.readout_realtime_label() },
		{
			v: String(THEOREMS_COMPLETE),
			l: m.readout_theorems_label({ checked: THEOREMS_CHECKED })
		},
		{ v: String(DOMAINS.length), l: m.readout_domains_label() }
	]);
	const pillars = $derived([
		{
			cvar: 'var(--charge-r)',
			icon: 'shield',
			title: m.pillar_safe_title(),
			body: m.pillar_safe_body()
		},
		{
			cvar: 'var(--charge-b)',
			icon: 'bolt',
			title: m.pillar_realtime_title(),
			// Both figures come from $lib/evidence.ts as message params, never re-inlined into
			// the prose (docs/evidence.md) — this string used to hardcode them, so a re-measure
			// would have left the pillar stale while every other surface moved (DAR-46).
			body: m.pillar_realtime_body({
				latency: CFC_KERNEL_LATENCY,
				multiple: REALTIME_MULTIPLE
			})
		},
		{
			cvar: 'var(--charge-g)',
			icon: 'cycle',
			title: m.pillar_selfimproving_title(),
			body: m.pillar_selfimproving_body()
		}
	]);
</script>

{#snippet icon(name: string)}
	<Icon class="size-5" strokeWidth={1.5}>
		{#if name === 'shield'}
			<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
			<path d="M9 12l2 2 4-4" />
		{:else if name === 'bolt'}
			<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
		{:else if name === 'cycle'}
			<path d="M21 12a9 9 0 1 1-3-6.7" />
			<path d="M21 3v5h-5" />
		{/if}
	</Icon>
{/snippet}

{#snippet sectionHead(kicker: string, heading: string, sub?: string)}
	<div class="p-8 text-center sm:p-10">
		<p class="eyebrow-panel">{kicker}</p>
		<h2 class="mx-auto mt-3 max-w-3xl text-3xl font-medium tracking-tight text-white">{heading}</h2>
		{#if sub}
			<!-- Optional systems-stack caption (mono, one line). Reframes the polyglot
			     stack as an engineering signal, not a line-count cost metric (issue #14). -->
			<p class="mt-4 font-mono text-xs tracking-wide text-muted">{sub}</p>
		{/if}
	</div>
{/snippet}

<Seo />

<CosmicBackdrop />

<div class="space-y-24">
	<section class="-mt-10 flex flex-col items-center px-6 pt-6 pb-16 text-center sm:pt-8">
		<p class="eyebrow-hero">
			{m.hero_kicker()}
		</p>

		<!-- The twisting triple helix centres in this gap; CosmicBackdrop measures
		     #helix-slot to place and size it responsively. -->
		<div id="helix-slot" class="h-6 min-[360px]:h-[min(25vw,19rem)]"></div>

		<div class="glass-card mx-auto w-full max-w-3xl px-8 py-10 text-center sm:px-10 sm:py-12">
			<!-- Heading split into three message fragments so the charge-flow emphasis can
			     wrap only "prove"; keep them as one grammatical set. Whitespace lives in the
			     markup (Svelte collapses it to single spaces) — never bake spaces into the
			     message values, or the rendered line double-spaces. -->
			<h1 class="text-4xl font-medium tracking-tight text-balance text-white sm:text-6xl">
				{m.hero_heading_lead()}
				<span class="charge-flow">{m.hero_heading_emphasis()}</span>
				{m.hero_heading_tail()}
			</h1>
			<p class="mx-auto mt-6 max-w-xl text-base text-body sm:text-lg">
				{m.hero_body()}
			</p>
			<div class="mt-9 flex flex-wrap justify-center gap-3">
				<a href="#gide" class="glass-btn btn-pill">{m.hero_cta_explore()}</a>
				<!-- `tap`, not the body-wide `hover` default: /waitlist's load records the funnel's
				     `waitlist_viewed` event (DAR-66), and a hover prefetch runs that load for a page the
				     visitor never opens — every mouse pass over this button would inflate the denominator
				     of the primary conversion metric with a view that can never convert. Preloading on
				     pointerdown still starts the fetch before the navigation, so the latency win survives;
				     a hover-then-click reuses that single request, so a real visitor is counted once. -->
				<a
					href={localizeHref('/waitlist')}
					data-sveltekit-preload-data="tap"
					class="glass-btn btn-pill">{m.hero_cta_waitlist()}</a
				>
				<button
					type="button"
					aria-haspopup="dialog"
					onclick={() => contactDialog.show()}
					class="glass-btn btn-pill">{m.hero_cta_contact()}</button
				>
			</div>
		</div>
	</section>

	<div class="mx-auto max-w-5xl space-y-16">
		<div
			class="glass-card flex flex-wrap items-center justify-center gap-x-12 gap-y-4 px-8 py-7 text-center"
		>
			{#each readouts as ro (ro.l)}
				<div>
					<div class="font-mono text-lg text-white sm:text-xl">{ro.v}</div>
					<div class="mt-0.5 eyebrow-label">
						{ro.l}
					</div>
				</div>
			{/each}
			<!-- The path from claim to evidence (DAR-43): every figure above is scoped, dated,
			     and bounded on /evidence. `w-full` drops the link onto its own centered row. -->
			<div class="w-full">
				<a href={localizeHref('/evidence')} class={mutedLinkClass}>
					{m.readout_evidence_link()}
				</a>
			</div>
		</div>

		<section id="gide" class="glass-card scroll-mt-24 overflow-hidden">
			{@render sectionHead(m.section_gide_kicker(), m.section_gide_heading())}
			<div
				class="grid divide-y divide-hairline border-t border-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0"
			>
				{#each pillars as p (p.title)}
					<div class="p-7">
						<div
							class="flex size-10 items-center justify-center rounded-lg"
							style="color: {p.cvar}; background: color-mix(in oklab, {p.cvar} 12%, transparent);"
						>
							{@render icon(p.icon)}
						</div>
						<h3 class="mt-5 text-base font-medium text-white">{p.title}</h3>
						<p class="mt-2 text-sm leading-relaxed text-body">{p.body}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="glass-card overflow-hidden">
			{@render sectionHead(
				m.section_domains_kicker(),
				m.section_domains_heading(),
				m.section_domains_sub()
			)}
			<div class="divide-y divide-hairline border-t border-hairline">
				{#each domains as d (d.n)}
					<div class="flex flex-col gap-1 px-8 py-5 sm:flex-row sm:items-baseline sm:gap-6">
						<div class="w-52 shrink-0 text-sm font-medium text-white">{d.n}</div>
						<div class="text-sm text-body">{d.d}</div>
					</div>
				{/each}
				<!-- What the "domains running end-to-end" figure actually asserts (DAR-46). It sits
				     here, at the end of the list the reader is looking at, rather than under the
				     stats row where it would explain one of four figures. /evidence carries the
				     per-domain maturity. -->
				<p class="px-8 py-5 text-sm leading-relaxed text-muted">
					{m.section_domains_scope()}
				</p>
			</div>
		</section>

		<section class="glass-card p-10 text-center sm:p-16">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				{m.section_proven_heading()}
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-body sm:text-base">
				{m.section_proven_body()}
			</p>
			<p class="mt-6">
				<a href={localizeHref('/evidence')} class={inlineLinkClass}>
					{m.section_proven_evidence_link()}
				</a>
			</p>
		</section>

		<section class="glass-card px-8 py-14 text-center">
			<h2 class="text-3xl font-medium tracking-tight text-white sm:text-4xl">
				{m.section_cta_heading()}
			</h2>
			<p class="mx-auto mt-4 max-w-lg text-sm text-body">
				{m.section_cta_body()}
			</p>
			<button
				type="button"
				aria-haspopup="dialog"
				onclick={() => contactDialog.show()}
				class="glass-btn mt-8 inline-flex items-center gap-3 rounded-full px-7 py-3.5 text-lg font-medium text-white"
			>
				<img src={favicon} alt="" class="size-14" />
				{m.section_cta_button()}
			</button>
		</section>
	</div>
</div>
