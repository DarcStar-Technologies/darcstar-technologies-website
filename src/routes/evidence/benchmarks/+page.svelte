<script lang="ts">
	// /evidence/benchmarks — the run-level detail behind the latency figures: per-run methodology,
	// environment, attribution (including the logged gaps), and the artifacts. Split out of the
	// /evidence CfC card (which keeps the headline + a summary and links here) so the main page
	// states claims and this page carries the hardware runs. Same content-only mold as /evidence;
	// figures shared via $lib/evidence.ts, run-level numbers live in the messages here only.
	// The artifacts live in a private repo, so this page documents them — it deliberately does
	// NOT promise a public reproduction path; keep the copy inside what a reader can act on.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import EvidenceClaimHeader from '$lib/components/EvidenceClaimHeader.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { inlineLinkClass } from '$lib/styles';
	import {
		CFC_KERNEL_LATENCY,
		CONTROLLER_LATENCY_P50,
		CONTROLLER_LATENCY_P99,
		CONTROLLER_MARGIN_P50,
		CONTROLLER_MARGIN_P99
	} from '$lib/evidence';
	import { breadcrumbJsonLd } from '$lib/jsonld';
	import { page } from '$app/state';

	// Home → Evidence → here (DAR-48's builder): the first static pages with a parent, so the
	// hierarchy is worth emitting — search results otherwise show these as orphan pages.
	const jsonLd = $derived([
		breadcrumbJsonLd([
			{ name: m.footer_nav_home(), url: page.url.origin + localizeHref('/') },
			{ name: m.evidence_eyebrow(), url: page.url.origin + localizeHref('/evidence') },
			{ name: m.evidence_bench_page_heading(), url: page.url.origin + page.url.pathname }
		])
	]);
</script>

<!-- One labeled field row (the /evidence card-field shape — eyebrow label + body). -->
{#snippet field(label: string, body: string)}
	<div>
		<h3 class="eyebrow-label">{label}</h3>
		<p class="mt-1.5 text-sm leading-relaxed text-body">{body}</p>
	</div>
{/snippet}

<Seo
	title={m.evidence_bench_page_title()}
	description={m.evidence_bench_page_description()}
	{jsonLd}
/>

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.evidence_eyebrow()}
		heading={m.evidence_bench_heading()}
		emphasis={m.evidence_bench_heading_emphasis()}
		lead={m.evidence_bench_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<p class="text-sm">
			<a href={localizeHref('/evidence')} class={inlineLinkClass}>{m.evidence_back()}</a>
		</p>

		<section class="glass-card p-8 sm:p-10">
			<EvidenceClaimHeader
				value={CFC_KERNEL_LATENCY}
				title={m.evidence_bench_kernel_heading()}
				dated={m.evidence_cfc_dated()}
				claim={m.evidence_cfc_claim({ latency: CFC_KERNEL_LATENCY })}
			/>
			<div class="mt-6 space-y-5">
				{@render field(m.evidence_label_method(), m.evidence_bench_kernel_method())}
				{@render field(m.evidence_label_environment(), m.evidence_cfc_environment())}
			</div>
		</section>

		<section class="glass-card p-8 sm:p-10">
			<h2 class="heading-subsection">
				{m.evidence_bench_reruns_heading()}
			</h2>
			<div class="mt-6 space-y-5">
				{@render field(m.evidence_bench_rerun_arm_label(), m.evidence_bench_rerun_arm_body())}
				{@render field(m.evidence_bench_rerun_x86_label(), m.evidence_bench_rerun_x86_body())}
			</div>
		</section>

		<!-- No headline `value`: the claim is a p50/p99 PAIR, and picking one of them for the large
		     type is how DAR-209's unattributed margin happened in the first place. The header's
		     `value` is optional for exactly this case. -->
		<section class="glass-card p-8 sm:p-10">
			<EvidenceClaimHeader
				title={m.evidence_bench_controller_heading()}
				dated={m.evidence_bench_controller_dated()}
				claim={m.evidence_bench_controller_body({
					p50: CONTROLLER_LATENCY_P50,
					p99: CONTROLLER_LATENCY_P99,
					marginP50: CONTROLLER_MARGIN_P50,
					marginP99: CONTROLLER_MARGIN_P99
				})}
			/>
			<div class="mt-6 space-y-5">
				{@render field(m.evidence_label_method(), m.evidence_bench_controller_method())}
				{@render field(m.evidence_label_environment(), m.evidence_bench_controller_environment())}
			</div>
		</section>

		<section class="glass-card p-8 sm:p-10">
			<h2 class="heading-subsection">
				{m.evidence_bench_artifacts_heading()}
			</h2>
			<p class="mt-4 text-sm leading-relaxed text-body">{m.evidence_cfc_artifacts()}</p>
		</section>
	</div>
</div>
