<script lang="ts">
	// /evidence/proofs — what machine-checked means: the definition behind the theorem count
	// (complete vs axiom-backed), the provers and checkers, the verification methodology, and the
	// trust boundary. Split out of the /evidence theorems card (which keeps the count + definition
	// summary and links here). Deliberately absent, here and on the card: the catalog total and the
	// not-yet-mechanized remainder — the public surface states what IS proven, not the backlog.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import LegalSection from '$lib/components/LegalSection.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { inlineLinkClass } from '$lib/styles';
	import { breadcrumbJsonLd } from '$lib/jsonld';
	import { page } from '$app/state';

	// Home → Evidence → here (DAR-48's builder); see the benchmarks page for the rationale.
	const jsonLd = $derived([
		breadcrumbJsonLd([
			{ name: m.footer_nav_home(), url: page.url.origin + localizeHref('/') },
			{ name: m.evidence_eyebrow(), url: page.url.origin + localizeHref('/evidence') },
			{ name: m.evidence_proofs_page_heading(), url: page.url.origin + page.url.pathname }
		])
	]);
</script>

<Seo
	title={m.evidence_proofs_page_title()}
	description={m.evidence_proofs_page_description()}
	{jsonLd}
/>

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.evidence_eyebrow()}
		heading={m.evidence_proofs_heading()}
		emphasis={m.evidence_proofs_heading_emphasis()}
		lead={m.evidence_proofs_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<p class="text-sm">
			<a href={localizeHref('/evidence')} class={inlineLinkClass}>{m.evidence_back()}</a>
		</p>

		<div class="glass-card divide-y divide-hairline">
			<LegalSection
				heading={m.evidence_proofs_definition_heading()}
				body={m.evidence_proofs_definition_body()}
			/>
			<LegalSection heading={m.evidence_label_provers()} body={m.evidence_theorems_provers()} />
			<LegalSection heading={m.evidence_label_method()} body={m.evidence_theorems_method()} />
			<LegalSection
				heading={m.evidence_proofs_boundary_heading()}
				body={m.evidence_theorems_not_covered()}
			/>
			<LegalSection heading={m.evidence_label_artifacts()} body={m.evidence_theorems_artifacts()} />
		</div>
	</div>
</div>
