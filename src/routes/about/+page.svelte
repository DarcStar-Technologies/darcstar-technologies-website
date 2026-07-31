<script lang="ts">
	// The real /about page (issue #61) — retires the old header `#about` → footer-anchor
	// workaround. Content-only: no loader, all copy in Paraglide messages, one <Seo>, and the
	// same CosmicBackdrop + frosted-glass aesthetic as the homepage. Facts reuse only the
	// settled public details (trade name, "United States", GitHub + email) — nothing invented.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import ContactLinks from '$lib/components/ContactLinks.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	// Brand identity from the single source (src/lib/site.ts); the contact channels render via
	// the shared ContactLinks (same block as the legal pages' contact sections).
	import { SITE_NAME } from '$lib/site';

	// $derived so the three principles re-resolve if a locale switcher is ever added
	// (getLocale() is $state-backed); `title` is a stable {#each} key across switches.
	const principles = $derived([
		{ title: m.about_principle_proof_title(), body: m.about_principle_proof_body() },
		{ title: m.about_principle_realtime_title(), body: m.about_principle_realtime_body() },
		{ title: m.about_principle_oneengine_title(), body: m.about_principle_oneengine_body() }
	]);
</script>

<Seo title={m.about_page_title()} description={m.about_page_description()} />

<CosmicBackdrop />

<div class="space-y-20">
	<!-- The shared hero, with the emphasis LEADING ("Provable safety for …") rather than trailing.
	     This page used to carry a byte-identical copy of PageHero's markup, kept only because the
	     component's emphasis was trailing-only (DAR-218).
	     The extra bottom space is this page's own concern, not the hero's: /about runs a roomier
	     rhythm than the PageHero routes (space-y-20 against their space-y-14), and its 2rem here on
	     top of the hero's own 2rem is what keeps the gap under the hero proportional to that —
	     preserving the spacing exactly, without giving the shared component a padding knob. -->
	<div class="pb-8">
		<PageHero
			eyebrow={m.about_eyebrow()}
			heading={m.about_heading_tail()}
			emphasis={m.about_heading_emphasis()}
			emphasisPosition="leading"
			lead={m.about_lead()}
		/>
	</div>

	<div class="mx-auto max-w-3xl space-y-14">
		<!-- Mission -->
		<section class="glass-card p-8 sm:p-10">
			<h2 class="heading-section">
				{m.about_mission_heading()}
			</h2>
			<p class="mt-4 text-sm leading-relaxed text-body sm:text-base">{m.about_mission_body_1()}</p>
			<p class="mt-4 text-sm leading-relaxed text-body sm:text-base">{m.about_mission_body_2()}</p>
		</section>

		<!-- Principles -->
		<section class="glass-card overflow-hidden">
			<div class="p-8 sm:p-10">
				<h2 class="heading-section">
					{m.about_principles_heading()}
				</h2>
			</div>
			<div class="divide-y divide-hairline border-t border-hairline">
				{#each principles as p (p.title)}
					<div class="px-8 py-6 sm:px-10">
						<h3 class="text-base font-medium text-white">{p.title}</h3>
						<p class="mt-2 text-sm leading-relaxed text-body">{p.body}</p>
					</div>
				{/each}
			</div>
		</section>

		<!-- At a glance -->
		<section class="glass-card p-8 sm:p-10">
			<h2 class="heading-section">
				{m.about_facts_heading()}
			</h2>
			<dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-[10rem_1fr]">
				<dt class="eyebrow-label">{m.about_facts_company_label()}</dt>
				<dd class="text-sm text-emphasis">{SITE_NAME}</dd>

				<dt class="eyebrow-label">{m.about_facts_location_label()}</dt>
				<dd class="text-sm text-emphasis">{m.footer_location()}</dd>

				<dt class="eyebrow-label">{m.about_facts_focus_label()}</dt>
				<dd class="text-sm text-emphasis">{m.about_facts_focus_value()}</dd>

				<dt class="eyebrow-label">{m.about_facts_contact_label()}</dt>
				<dd class="flex flex-col gap-1.5 text-sm">
					<ContactLinks />
				</dd>
			</dl>
		</section>

		<!-- CTA -->
		<section class="glass-card px-8 py-12 text-center">
			<h2 class="heading-section">
				{m.about_cta_heading()}
			</h2>
			<p class="mx-auto mt-4 max-w-md text-sm text-body">{m.about_cta_body()}</p>
			<button
				type="button"
				aria-haspopup="dialog"
				onclick={() => contactDialog.show()}
				class="glass-btn btn-pill mt-8">{m.about_cta_button()}</button
			>
		</section>
	</div>
</div>
