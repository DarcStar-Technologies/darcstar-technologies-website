<script lang="ts">
	// The real /about page (issue #61) — retires the old header `#about` → footer-anchor
	// workaround. Content-only: no loader, all copy in Paraglide messages, one <Seo>, and the
	// same CosmicBackdrop + frosted-glass aesthetic as the homepage. Facts reuse only the
	// settled public details (trade name, "United States", GitHub + email) — nothing invented.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { contactDialog } from '$lib/contact-dialog.svelte';

	// Proper-noun / contact constants — rendered as `{expr}` mustaches (not raw template
	// text), so the no-raw-text ESLint rule leaves them alone, and the real address/handle
	// stay visible. Mirrors Footer.svelte / Seo.svelte, which hold the same literals.
	const SITE = 'DarcStar Technologies';
	const email = 'info@darcstar.tech';
	const githubUrl = 'https://github.com/DarcStar-Technologies';
	const githubHandle = 'DarcStar-Technologies';

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
	<!-- Intro -->
	<section class="flex flex-col items-center px-6 pt-6 pb-4 text-center sm:pt-10">
		<p class="eyebrow text-sm tracking-[0.3em]">{m.about_eyebrow()}</p>
		<h1 class="mt-6 text-4xl font-medium tracking-tight text-balance text-white sm:text-5xl">
			<span class="charge-flow">{m.about_heading_emphasis()}</span>
			{m.about_heading_tail()}
		</h1>
		<p class="mx-auto mt-6 max-w-2xl text-base text-body sm:text-lg">{m.about_lead()}</p>
	</section>

	<div class="mx-auto max-w-3xl space-y-14">
		<!-- Mission -->
		<section class="glass-panel rounded-2xl p-8 sm:p-10">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				{m.about_mission_heading()}
			</h2>
			<p class="mt-4 text-sm leading-relaxed text-body sm:text-base">{m.about_mission_body_1()}</p>
			<p class="mt-4 text-sm leading-relaxed text-body sm:text-base">{m.about_mission_body_2()}</p>
		</section>

		<!-- Principles -->
		<section class="glass-panel overflow-hidden rounded-2xl">
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
		<section class="glass-panel rounded-2xl p-8 sm:p-10">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				{m.about_facts_heading()}
			</h2>
			<dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-[10rem_1fr]">
				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_company_label()}</dt>
				<dd class="text-sm text-emphasis">{SITE}</dd>

				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_location_label()}</dt>
				<dd class="text-sm text-emphasis">{m.footer_location()}</dd>

				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_focus_label()}</dt>
				<dd class="text-sm text-emphasis">{m.about_facts_focus_value()}</dd>

				<dt class="eyebrow text-xs tracking-widest">{m.about_facts_contact_label()}</dt>
				<dd class="flex flex-col gap-1.5 text-sm">
					<a
						href={githubUrl}
						target="_blank"
						rel="noreferrer"
						class="text-body transition-colors hover:text-primary-500">{githubHandle}</a
					>
					<a href={`mailto:${email}`} class="text-body transition-colors hover:text-primary-500"
						>{email}</a
					>
				</dd>
			</dl>
		</section>

		<!-- CTA -->
		<section class="glass-panel rounded-2xl px-8 py-12 text-center">
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
