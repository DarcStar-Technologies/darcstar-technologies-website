<script lang="ts">
	// The real /about page (issue #61) — retires the old header `#about` → footer-anchor
	// workaround. Content-only: no loader, all copy in Paraglide messages, one <Seo>, and the
	// same CosmicBackdrop + frosted-glass aesthetic as the homepage. Facts reuse only the
	// settled public details (trade name, "United States", GitHub + email) — nothing invented.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';
	// Brand/contact identity from the single source (src/lib/site.ts). Rendered as `{expr}`
	// mustaches below, so the real address/handle stay visible and the no-raw-text rule is
	// satisfied.
	import { SITE_NAME, CONTACT_EMAIL, GITHUB_URL, GITHUB_HANDLE } from '$lib/site';

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
	<!-- Hero — matches the homepage standard (the pattern for every page's hero): kicker,
	     then the twisting triple helix, then the heading + lead inside a frosted glass-panel. -->
	<section class="-mt-10 flex flex-col items-center px-6 pt-6 pb-16 text-center sm:pt-8">
		<p class="eyebrow text-sm tracking-[0.3em]">{m.about_eyebrow()}</p>

		<!-- CosmicBackdrop measures #helix-slot to place + SIZE the helix (its height caps the
		     amplitude), so keep the height; the panel below rises onto the helix's lower arcs
		     (negative margin) instead of sitting fully below it, reclaiming vertical space while the
		     upper arcs stay visible. Mirrors PageHero (/news · /research · /people). -->
		<div id="helix-slot" class="h-6 min-[360px]:h-[min(25vw,19rem)]"></div>

		<div
			class="glass-card mx-auto w-full max-w-3xl px-8 py-10 text-center min-[360px]:-mt-[min(23vw,17.5rem)] sm:px-10 sm:py-12"
		>
			<h1 class="text-4xl font-medium tracking-tight text-balance text-white sm:text-5xl">
				<span class="charge-flow">{m.about_heading_emphasis()}</span>
				{m.about_heading_tail()}
			</h1>
			<p class="mx-auto mt-6 max-w-2xl text-base text-body sm:text-lg">{m.about_lead()}</p>
		</div>
	</section>

	<div class="mx-auto max-w-3xl space-y-14">
		<!-- Mission -->
		<section class="glass-card p-8 sm:p-10">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				{m.about_mission_heading()}
			</h2>
			<p class="mt-4 text-sm leading-relaxed text-body sm:text-base">{m.about_mission_body_1()}</p>
			<p class="mt-4 text-sm leading-relaxed text-body sm:text-base">{m.about_mission_body_2()}</p>
		</section>

		<!-- Principles -->
		<section class="glass-card overflow-hidden">
			<div class="p-8 sm:p-10">
				<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
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
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				{m.about_facts_heading()}
			</h2>
			<dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-[10rem_1fr]">
				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_company_label()}</dt>
				<dd class="text-sm text-emphasis">{SITE_NAME}</dd>

				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_location_label()}</dt>
				<dd class="text-sm text-emphasis">{m.footer_location()}</dd>

				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_focus_label()}</dt>
				<dd class="text-sm text-emphasis">{m.about_facts_focus_value()}</dd>

				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_contact_label()}</dt>
				<dd class="flex flex-col gap-1.5 text-sm">
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						class="text-body transition-colors hover:text-primary-500">{GITHUB_HANDLE}</a
					>
					<a
						href={`mailto:${CONTACT_EMAIL}`}
						class="text-body transition-colors hover:text-primary-500">{CONTACT_EMAIL}</a
					>
				</dd>
			</dl>
		</section>

		<!-- CTA -->
		<section class="glass-card px-8 py-12 text-center">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
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
