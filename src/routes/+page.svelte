<script lang="ts">
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import Icon from '$lib/components/Icon.svelte';

	// Domains the one engine has actually shipped into. Declared before `readouts`
	// so the stats row can source its "domains shipped" figure from this list's
	// length — the number can never drift from the rows rendered in the section below.
	// `$derived` (not a plain const): the visible copy is Paraglide messages, so the
	// array re-resolves if a locale switcher is ever added — getLocale() is $state-backed
	// (src/lib/paraglide.svelte.ts). On SSR it evaluates exactly once. Structural fields
	// (icon/cvar) stay literal.
	const domains = $derived([
		{ n: m.domain_cartpole_name(), d: m.domain_cartpole_desc() },
		{ n: m.domain_quadrotor_name(), d: m.domain_quadrotor_desc() },
		{ n: m.domain_markets_name(), d: m.domain_markets_desc() },
		{ n: m.domain_llm_name(), d: m.domain_llm_desc() },
		{ n: m.domain_selfdev_name(), d: m.domain_selfdev_desc() }
	]);

	// Stats row — REAL, verifiable numbers only (issue #13). Latency and the 13,000×
	// real-time margin are measured; "theorems proven" is the machine-checked count;
	// "domains shipped" is `domains.length`. Only the LABELS are messages — the values
	// stay as data: they're en-formatted figures, not translatable prose (a real `es`
	// would run them through Intl.NumberFormat, e.g. "13.000×"), and the numbers must
	// read identically across locales.
	const readouts = $derived([
		{ v: '0.767 µs', l: m.readout_cfc_label() },
		{ v: '13,000×', l: m.readout_realtime_label() },
		{ v: '150', l: m.readout_theorems_label() },
		{ v: String(domains.length), l: m.readout_domains_label() }
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
			body: m.pillar_realtime_body()
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
		<p class="eyebrow text-xs tracking-[0.25em]">{kicker}</p>
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
		<p class="eyebrow text-sm tracking-[0.3em]">
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
					<div class="mt-0.5 eyebrow text-xs tracking-widest">
						{ro.l}
					</div>
				</div>
			{/each}
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
			</div>
		</section>

		<section class="glass-card p-10 text-center sm:p-16">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				{m.section_proven_heading()}
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-body sm:text-base">
				{m.section_proven_body()}
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
