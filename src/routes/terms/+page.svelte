<script lang="ts">
	// Terms of service (DAR-44) — content-only legal page, same shell as /privacy: no loader,
	// all copy in Paraglide messages, one <Seo>, shared helix hero, one divided frosted card.
	// Deliberately has no governing-law state clause — the settled public facts pin location to
	// "United States" only; add a state here if/when the entity registers one.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { CONTACT_EMAIL, GITHUB_URL, GITHUB_HANDLE } from '$lib/site';
</script>

<Seo title={m.terms_page_title()} description={m.terms_page_description()} />

<CosmicBackdrop />

{#snippet section(heading: string, body: string)}
	<section class="px-8 py-7 sm:px-10">
		<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">{heading}</h2>
		<p class="mt-3 text-sm leading-relaxed text-body">{body}</p>
	</section>
{/snippet}

<div class="space-y-14">
	<PageHero
		eyebrow={m.terms_eyebrow()}
		heading={m.terms_heading()}
		emphasis={m.terms_heading_emphasis()}
		lead={m.terms_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl">
		<p class="text-center text-xs text-muted">{m.terms_updated()}</p>

		<div class="glass-card mt-6 divide-y divide-hairline">
			{@render section(m.terms_agreement_heading(), m.terms_agreement_body())}
			{@render section(m.terms_use_heading(), m.terms_use_body())}
			{@render section(m.terms_accounts_heading(), m.terms_accounts_body())}
			{@render section(m.terms_waitlist_heading(), m.terms_waitlist_body())}
			{@render section(m.terms_content_heading(), m.terms_content_body())}
			{@render section(m.terms_thirdparty_heading(), m.terms_thirdparty_body())}
			{@render section(m.terms_disclaimer_heading(), m.terms_disclaimer_body())}
			{@render section(m.terms_liability_heading(), m.terms_liability_body())}
			{@render section(m.terms_changes_heading(), m.terms_changes_body())}

			<!-- Contact — the real address/handle come from src/lib/site.ts ({expr} mustaches). -->
			<section class="px-8 py-7 sm:px-10">
				<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">
					{m.terms_contact_heading()}
				</h2>
				<p class="mt-3 text-sm leading-relaxed text-body">{m.terms_contact_body()}</p>
				<p class="mt-3 flex flex-col gap-1.5 text-sm">
					<a
						href={`mailto:${CONTACT_EMAIL}`}
						class="text-body transition-colors hover:text-primary-500">{CONTACT_EMAIL}</a
					>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						class="text-body transition-colors hover:text-primary-500">{GITHUB_HANDLE}</a
					>
				</p>
			</section>
		</div>
	</div>
</div>
