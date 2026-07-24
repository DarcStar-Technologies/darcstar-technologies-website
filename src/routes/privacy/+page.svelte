<script lang="ts">
	// Privacy policy (DAR-44) — content-only legal page, /about's mold: no loader, all copy in
	// Paraglide messages, one <Seo>, the shared helix hero, and the whole document in a single
	// frosted card of LegalSection blocks. The facts stay within the settled public set (trade
	// name only, "United States", GitHub + email) and the data-flow claims mirror what the code
	// actually does — including the user-agent + hashed IP stored with contact/waitlist
	// submissions, the public (≥3-people) waitlist interest suggestions, the message→account
	// backfill, and the no-language-cookie URL locale — keep this page truthful when those
	// flows change, and bump PRIVACY_UPDATED (src/lib/legal.ts) when you do.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import LegalSection from '$lib/components/LegalSection.svelte';
	import ContactLinks from '$lib/components/ContactLinks.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { PRIVACY_UPDATED } from '$lib/legal';
</script>

<Seo title={m.privacy_page_title()} description={m.privacy_page_description()} />

<CosmicBackdrop />

<!-- A titled list inside a section (what we collect / who processes it). Index-keyed: the
     entries are static per locale, and value keys would crash (each_key_duplicate) if a
     translation ever rendered two of them identically. h3 (not dt) so the per-item titles
     stay in screen-reader heading navigation — the /about principles pattern. -->
{#snippet items(entries: { title: string; body: string }[])}
	<div class="mt-5 space-y-5">
		{#each entries as entry, i (i)}
			<div>
				<h3 class="text-base font-medium text-white">{entry.title}</h3>
				<p class="mt-1.5 text-sm leading-relaxed text-body">{entry.body}</p>
			</div>
		{/each}
	</div>
{/snippet}

<div class="space-y-14">
	<PageHero
		eyebrow={m.privacy_eyebrow()}
		heading={m.privacy_heading()}
		emphasis={m.privacy_heading_emphasis()}
		lead={m.privacy_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl">
		<p class="text-center text-xs text-muted">
			{m.legal_updated({ date: formatDate(PRIVACY_UPDATED, getLocale()) })}
		</p>

		<div class="glass-card mt-6 divide-y divide-hairline">
			<LegalSection heading={m.privacy_overview_heading()} body={m.privacy_overview_body()} />

			<LegalSection heading={m.privacy_collect_heading()} body={m.privacy_collect_intro()}>
				{@render items([
					{ title: m.privacy_collect_contact_title(), body: m.privacy_collect_contact_body() },
					{ title: m.privacy_collect_waitlist_title(), body: m.privacy_collect_waitlist_body() },
					{ title: m.privacy_collect_account_title(), body: m.privacy_collect_account_body() },
					{ title: m.privacy_collect_technical_title(), body: m.privacy_collect_technical_body() }
				])}
			</LegalSection>

			<LegalSection heading={m.privacy_use_heading()} body={m.privacy_use_body()} />

			<LegalSection heading={m.privacy_processors_heading()} body={m.privacy_processors_intro()}>
				{@render items([
					{
						title: m.privacy_processors_cloudflare_title(),
						body: m.privacy_processors_cloudflare_body()
					},
					{ title: m.privacy_processors_turso_title(), body: m.privacy_processors_turso_body() },
					{ title: m.privacy_processors_resend_title(), body: m.privacy_processors_resend_body() },
					{ title: m.privacy_processors_sanity_title(), body: m.privacy_processors_sanity_body() }
				])}
			</LegalSection>

			<LegalSection heading={m.privacy_retention_heading()} body={m.privacy_retention_body()} />
			<LegalSection heading={m.privacy_rights_heading()} body={m.privacy_rights_body()} />
			<LegalSection heading={m.privacy_security_heading()} body={m.privacy_security_body()} />
			<LegalSection heading={m.privacy_children_heading()} body={m.privacy_children_body()} />
			<LegalSection heading={m.privacy_changes_heading()} body={m.privacy_changes_body()} />

			<LegalSection heading={m.privacy_contact_heading()} body={m.privacy_contact_body()}>
				<p class="mt-3 flex flex-col gap-1.5 text-sm"><ContactLinks /></p>
			</LegalSection>
		</div>
	</div>
</div>
