<script lang="ts">
	// /evidence/benchmarks — the run-level detail behind the latency figures: per-run methodology,
	// environment, attribution (including the logged gaps), and the reproduction path. Split out of
	// the /evidence CfC card (which keeps the headline + a summary and links here) so the main page
	// states claims and this page carries the hardware runs. Same content-only mold as /evidence;
	// figures shared via $lib/evidence.ts, run-level numbers live in the messages here only.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { inlineLinkClass } from '$lib/styles';
	import { CFC_KERNEL_LATENCY } from '$lib/evidence';
</script>

<Seo title={m.evidence_bench_page_title()} description={m.evidence_bench_page_description()} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.evidence_eyebrow()}
		heading={m.evidence_bench_heading()}
		emphasis={m.evidence_bench_heading_emphasis()}
		lead={m.evidence_bench_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<p>
			<a href={localizeHref('/evidence')} class={inlineLinkClass}>{m.evidence_back()}</a>
		</p>

		<section class="glass-card p-8 sm:p-10">
			<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<span class="font-mono text-2xl text-white">{CFC_KERNEL_LATENCY}</span>
				<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">
					{m.evidence_bench_kernel_heading()}
				</h2>
			</div>
			<p class="mt-1.5 font-mono text-xs tracking-wide text-muted">{m.evidence_cfc_dated()}</p>
			<p class="mt-4 text-sm leading-relaxed text-body">
				{m.evidence_cfc_claim({ latency: CFC_KERNEL_LATENCY })}
			</p>
			<div class="mt-6 space-y-5">
				<div>
					<h3 class="eyebrow text-xs tracking-widest">{m.evidence_label_method()}</h3>
					<p class="mt-1.5 text-sm leading-relaxed text-body">{m.evidence_bench_kernel_method()}</p>
				</div>
				<div>
					<h3 class="eyebrow text-xs tracking-widest">{m.evidence_label_environment()}</h3>
					<p class="mt-1.5 text-sm leading-relaxed text-body">{m.evidence_cfc_environment()}</p>
				</div>
			</div>
		</section>

		<section class="glass-card p-8 sm:p-10">
			<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">
				{m.evidence_bench_reruns_heading()}
			</h2>
			<div class="mt-6 space-y-5">
				<div>
					<h3 class="eyebrow text-xs tracking-widest">{m.evidence_bench_rerun_arm_label()}</h3>
					<p class="mt-1.5 text-sm leading-relaxed text-body">
						{m.evidence_bench_rerun_arm_body()}
					</p>
				</div>
				<div>
					<h3 class="eyebrow text-xs tracking-widest">{m.evidence_bench_rerun_x86_label()}</h3>
					<p class="mt-1.5 text-sm leading-relaxed text-body">
						{m.evidence_bench_rerun_x86_body()}
					</p>
				</div>
			</div>
		</section>

		<section class="glass-card p-8 sm:p-10">
			<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">
				{m.evidence_bench_controller_heading()}
			</h2>
			<p class="mt-4 text-sm leading-relaxed text-body">{m.evidence_bench_controller_body()}</p>
		</section>

		<section class="glass-card p-8 sm:p-10">
			<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">
				{m.evidence_bench_artifacts_heading()}
			</h2>
			<p class="mt-4 text-sm leading-relaxed text-body">{m.evidence_cfc_artifacts()}</p>
		</section>
	</div>
</div>
