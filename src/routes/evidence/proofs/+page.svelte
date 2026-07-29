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
	import TitledItems from '$lib/components/TitledItems.svelte';
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
			<!-- DAR-117. The definition above uses "declared local axioms" and the trust boundary
			     below uses "declared assumptions", and a reviewer meeting both in one page will read
			     them as one thing — they are materially different, and only one is proof debt. The
			     three items are the whole distinction: a hypothesis every theorem is stated under, a
			     stand-in for mathematics not derived in that proof, and a carried physical premise
			     that disqualifies the row from the count entirely. Deliberately no counts here: how
			     many carry what is the backlog, and the backlog is not published (docs/evidence.md).
			     The named assumptions must stay the ones evidence_theorems_not_covered names — two
			     pages listing different premises is the drift evidence-disclosure.spec.ts guards. -->
			<LegalSection
				heading={m.evidence_proofs_axioms_heading()}
				body={m.evidence_proofs_axioms_body()}
			>
				<TitledItems
					entries={[
						{
							title: m.evidence_proofs_axioms_assumptions_title(),
							body: m.evidence_proofs_axioms_assumptions_body()
						},
						{
							title: m.evidence_proofs_axioms_local_title(),
							body: m.evidence_proofs_axioms_local_body()
						},
						{
							title: m.evidence_proofs_axioms_carried_title(),
							body: m.evidence_proofs_axioms_carried_body()
						}
					]}
				/>
			</LegalSection>
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
