<script lang="ts">
	// /evidence (DAR-43) — the IP-safe backing for every major homepage claim: one card per claim
	// with its date/version, environment, methodology, assumptions, and — deliberately — what the
	// claim does NOT cover, plus the IP boundary (what stays private and the NDA path). Content-only
	// page on /privacy's mold: no loader, all copy in Paraglide messages.
	//
	// The facts here are transcribed from the GIDE hub's own source-of-record documents (benchmark
	// corpus + attribution ledger, theorem catalog + conformance registry) — see docs/evidence.md
	// for provenance and the update rules. Two invariants when editing:
	//   1. Numbers are DATED claims — a value and its dated line change together, never alone.
	//   2. The homepage readouts (src/routes/+page.svelte) must agree with these cards; the
	//      theorems figure on both surfaces is the machine-checked count (complete + axiom-backed).
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import LegalSection from '$lib/components/LegalSection.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';

	type EvidenceField = { label: string; body: string };
	type EvidenceCard = {
		id: string;
		/** Headline figure as data (en-formatted, identical across locales — the homepage readout
		 * convention); omitted where the claim has no single number. */
		value?: string;
		title: string;
		dated: string;
		claim: string;
		fields: EvidenceField[];
	};

	// `$derived` for the same reason as the homepage readouts: message calls re-resolve if a
	// locale switcher ever lands. Values stay literal data. Domain names reuse the homepage's
	// `domain_*_name` messages so the two lists can never drift apart.
	const cards = $derived<EvidenceCard[]>([
		{
			id: 'cfc-inference',
			value: '0.767 µs',
			title: m.evidence_cfc_title(),
			dated: m.evidence_cfc_dated(),
			claim: m.evidence_cfc_claim(),
			fields: [
				{ label: m.evidence_label_environment(), body: m.evidence_cfc_environment() },
				{ label: m.evidence_label_method(), body: m.evidence_cfc_method() },
				{ label: m.evidence_label_not_covered(), body: m.evidence_cfc_not_covered() },
				{ label: m.evidence_label_artifacts(), body: m.evidence_cfc_artifacts() }
			]
		},
		{
			id: 'realtime',
			value: '13,000×',
			title: m.evidence_realtime_title(),
			dated: m.evidence_realtime_dated(),
			claim: m.evidence_realtime_claim(),
			fields: [
				{ label: m.evidence_label_method(), body: m.evidence_realtime_method() },
				{ label: m.evidence_label_not_covered(), body: m.evidence_realtime_not_covered() }
			]
		},
		{
			id: 'theorems',
			value: '219',
			title: m.evidence_theorems_title(),
			dated: m.evidence_theorems_dated(),
			claim: m.evidence_theorems_claim(),
			fields: [
				{ label: m.evidence_label_provers(), body: m.evidence_theorems_provers() },
				{ label: m.evidence_label_method(), body: m.evidence_theorems_method() },
				{ label: m.evidence_label_not_covered(), body: m.evidence_theorems_not_covered() },
				{ label: m.evidence_label_artifacts(), body: m.evidence_theorems_artifacts() }
			]
		},
		{
			id: 'safety',
			title: m.evidence_safety_title(),
			dated: m.evidence_safety_dated(),
			claim: m.evidence_safety_claim(),
			fields: [
				{ label: m.evidence_label_proved(), body: m.evidence_safety_proved() },
				{ label: m.evidence_label_assumptions(), body: m.evidence_safety_assumptions() },
				{ label: m.evidence_label_not_covered(), body: m.evidence_safety_not_covered() }
			]
		},
		{
			id: 'domains',
			value: '5',
			title: m.evidence_domains_title(),
			dated: m.evidence_domains_dated(),
			claim: m.evidence_domains_claim(),
			fields: [
				{ label: m.domain_cartpole_name(), body: m.evidence_domain_cartpole_body() },
				{ label: m.domain_quadrotor_name(), body: m.evidence_domain_quadrotor_body() },
				{ label: m.domain_markets_name(), body: m.evidence_domain_markets_body() },
				{ label: m.domain_llm_name(), body: m.evidence_domain_llm_body() },
				{ label: m.domain_selfdev_name(), body: m.evidence_domain_selfdev_body() }
			]
		}
	]);
</script>

<Seo title={m.evidence_page_title()} description={m.evidence_page_description()} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.evidence_eyebrow()}
		heading={m.evidence_heading()}
		emphasis={m.evidence_heading_emphasis()}
		lead={m.evidence_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<div class="glass-card divide-y divide-hairline">
			<LegalSection heading={m.evidence_read_heading()} body={m.evidence_read_body()} />
			<LegalSection heading={m.evidence_boundary_heading()} body={m.evidence_boundary_body()} />
		</div>

		<!-- One claim per card. The header pairs the headline figure (mono, the homepage readout
		     styling) with the claim title; the dated line pins version/date — a figure and its
		     date change together. Field labels are h3s (not dt) so they stay in screen-reader
		     heading navigation, the /privacy items pattern. -->
		{#each cards as card (card.id)}
			<section id={card.id} class="glass-card scroll-mt-24 p-8 sm:p-10">
				<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
					{#if card.value}
						<span class="font-mono text-2xl text-white">{card.value}</span>
					{/if}
					<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">{card.title}</h2>
				</div>
				<p class="mt-1.5 font-mono text-xs tracking-wide text-muted">{card.dated}</p>
				<p class="mt-4 text-sm leading-relaxed text-body">{card.claim}</p>
				<div class="mt-6 space-y-5">
					{#each card.fields as field, i (i)}
						<div>
							<h3 class="eyebrow text-xs tracking-widest">{field.label}</h3>
							<p class="mt-1.5 text-sm leading-relaxed text-body">{field.body}</p>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<div class="glass-card divide-y divide-hairline">
			<LegalSection heading={m.evidence_ip_heading()} body={m.evidence_ip_body()} />
			<LegalSection heading={m.evidence_ip_access_heading()} body={m.evidence_ip_access_body()}>
				<button
					type="button"
					aria-haspopup="dialog"
					onclick={() => contactDialog.show()}
					class="glass-btn mt-5 rounded-full px-6 py-3 text-sm font-medium text-white"
				>
					{m.evidence_ip_cta()}
				</button>
			</LegalSection>
		</div>
	</div>
</div>
