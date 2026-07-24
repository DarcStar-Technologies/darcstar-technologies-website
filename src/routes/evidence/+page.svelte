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
	//   2. The headline figures + domain list are single-sourced in $lib/evidence.ts — the
	//      homepage readouts read the SAME constants, and the message prose takes them as
	//      parameters, so the claim and evidence surfaces cannot disagree.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import LegalSection from '$lib/components/LegalSection.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	import { inlineLinkClass } from '$lib/styles';
	import {
		CFC_KERNEL_LATENCY,
		DOMAINS,
		REALTIME_MULTIPLE,
		THEOREMS_AXIOM_BACKED,
		THEOREMS_CHECKED,
		THEOREMS_COMPLETE
	} from '$lib/evidence';

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
		/** Detail-page link (run-level benchmarks, proof methodology) rendered after the fields. */
		more?: { href: string; label: string };
	};

	// `$derived` for the same reason as the homepage readouts: message calls re-resolve if a
	// locale switcher ever lands. Values come from the $lib/evidence.ts constants (shared with
	// the homepage readouts); the domains card iterates the shared DOMAINS spine.
	const cards = $derived<EvidenceCard[]>([
		{
			id: 'cfc-inference',
			value: CFC_KERNEL_LATENCY,
			title: m.evidence_cfc_title(),
			dated: m.evidence_cfc_dated(),
			claim: m.evidence_cfc_claim({ latency: CFC_KERNEL_LATENCY }),
			fields: [
				{ label: m.evidence_label_method(), body: m.evidence_cfc_method() },
				{ label: m.evidence_label_not_covered(), body: m.evidence_cfc_not_covered() }
			],
			more: { href: '/evidence/benchmarks', label: m.evidence_cfc_more() }
		},
		{
			id: 'realtime',
			value: REALTIME_MULTIPLE,
			title: m.evidence_realtime_title(),
			dated: m.evidence_realtime_dated({ latency: CFC_KERNEL_LATENCY }),
			claim: m.evidence_realtime_claim({
				multiple: REALTIME_MULTIPLE,
				latency: CFC_KERNEL_LATENCY
			}),
			fields: [
				{ label: m.evidence_label_method(), body: m.evidence_realtime_method() },
				{ label: m.evidence_label_not_covered(), body: m.evidence_realtime_not_covered() }
			],
			more: { href: '/evidence/benchmarks', label: m.evidence_cfc_more() }
		},
		{
			id: 'theorems',
			value: String(THEOREMS_CHECKED),
			title: m.evidence_theorems_title(),
			dated: m.evidence_theorems_dated(),
			claim: m.evidence_theorems_claim({
				checked: THEOREMS_CHECKED,
				complete: THEOREMS_COMPLETE,
				axiomBacked: THEOREMS_AXIOM_BACKED
			}),
			fields: [{ label: m.evidence_label_not_covered(), body: m.evidence_theorems_not_covered() }],
			more: { href: '/evidence/proofs', label: m.evidence_theorems_more() }
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
			value: String(DOMAINS.length),
			title: m.evidence_domains_title(),
			dated: m.evidence_domains_dated(),
			claim: m.evidence_domains_claim(),
			fields: DOMAINS.map((d) => ({ label: d.name(), body: d.evidence() }))
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
				{#if card.more}
					<p class="mt-6 text-sm">
						<a href={localizeHref(card.more.href)} class={inlineLinkClass}>{card.more.label}</a>
					</p>
				{/if}
			</section>
		{/each}

		<div class="glass-card divide-y divide-hairline">
			<LegalSection heading={m.evidence_ip_heading()} body={m.evidence_ip_body()} />
			<LegalSection heading={m.evidence_ip_access_heading()} body={m.evidence_ip_access_body()}>
				<button
					type="button"
					aria-haspopup="dialog"
					onclick={() => contactDialog.show()}
					class="glass-btn btn-pill mt-5"
				>
					{m.evidence_ip_cta()}
				</button>
			</LegalSection>
		</div>
	</div>
</div>
