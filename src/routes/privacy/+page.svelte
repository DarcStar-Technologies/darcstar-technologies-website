<script lang="ts">
	// Privacy policy (DAR-44) — content-only legal page, /about's mold: no loader, all copy in
	// Paraglide messages, one <Seo>, the shared helix hero, and the whole document in a single
	// frosted card with divided sections. The facts stay within the settled public set (trade
	// name only, "United States", GitHub + email) and the data-flow claims mirror what the code
	// actually does (contact/waitlist/signup forms → Turso; email via Resend; hosting/Turnstile
	// via Cloudflare; Sanity is content-only) — keep this page truthful when those flows change.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { CONTACT_EMAIL, GITHUB_URL, GITHUB_HANDLE } from '$lib/site';
</script>

<Seo title={m.privacy_page_title()} description={m.privacy_page_description()} />

<CosmicBackdrop />

{#snippet paragraphs(bodies: string[])}
	{#each bodies as body (body)}
		<p class="mt-3 text-sm leading-relaxed text-body">{body}</p>
	{/each}
{/snippet}

<!-- A heading + prose section of the document. -->
{#snippet section(heading: string, bodies: string[])}
	<section class="px-8 py-7 sm:px-10">
		<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">{heading}</h2>
		{@render paragraphs(bodies)}
	</section>
{/snippet}

<!-- A section whose body is a titled list (what we collect / who processes it). -->
{#snippet listSection(heading: string, intro: string, items: { title: string; body: string }[])}
	<section class="px-8 py-7 sm:px-10">
		<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">{heading}</h2>
		<p class="mt-3 text-sm leading-relaxed text-body">{intro}</p>
		<dl class="mt-5 space-y-5">
			{#each items as item (item.title)}
				<div>
					<dt class="text-base font-medium text-white">{item.title}</dt>
					<dd class="mt-1.5 text-sm leading-relaxed text-body">{item.body}</dd>
				</div>
			{/each}
		</dl>
	</section>
{/snippet}

<div class="space-y-14">
	<PageHero
		eyebrow={m.privacy_eyebrow()}
		heading={m.privacy_heading()}
		emphasis={m.privacy_heading_emphasis()}
		lead={m.privacy_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl">
		<p class="text-center text-xs text-muted">{m.privacy_updated()}</p>

		<div class="glass-card mt-6 divide-y divide-hairline">
			{@render section(m.privacy_overview_heading(), [
				m.privacy_overview_body_1(),
				m.privacy_overview_body_2()
			])}

			{@render listSection(m.privacy_collect_heading(), m.privacy_collect_intro(), [
				{ title: m.privacy_collect_contact_title(), body: m.privacy_collect_contact_body() },
				{ title: m.privacy_collect_waitlist_title(), body: m.privacy_collect_waitlist_body() },
				{ title: m.privacy_collect_account_title(), body: m.privacy_collect_account_body() },
				{ title: m.privacy_collect_technical_title(), body: m.privacy_collect_technical_body() }
			])}

			{@render section(m.privacy_use_heading(), [m.privacy_use_body()])}

			{@render listSection(m.privacy_processors_heading(), m.privacy_processors_intro(), [
				{
					title: m.privacy_processors_cloudflare_title(),
					body: m.privacy_processors_cloudflare_body()
				},
				{ title: m.privacy_processors_turso_title(), body: m.privacy_processors_turso_body() },
				{ title: m.privacy_processors_resend_title(), body: m.privacy_processors_resend_body() },
				{ title: m.privacy_processors_sanity_title(), body: m.privacy_processors_sanity_body() }
			])}

			{@render section(m.privacy_retention_heading(), [m.privacy_retention_body()])}
			{@render section(m.privacy_rights_heading(), [m.privacy_rights_body()])}
			{@render section(m.privacy_security_heading(), [m.privacy_security_body()])}
			{@render section(m.privacy_children_heading(), [m.privacy_children_body()])}
			{@render section(m.privacy_changes_heading(), [m.privacy_changes_body()])}

			<!-- Contact — the real address/handle come from src/lib/site.ts ({expr} mustaches). -->
			<section class="px-8 py-7 sm:px-10">
				<h2 class="text-xl font-medium tracking-tight text-white sm:text-2xl">
					{m.privacy_contact_heading()}
				</h2>
				<p class="mt-3 text-sm leading-relaxed text-body">{m.privacy_contact_body()}</p>
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
