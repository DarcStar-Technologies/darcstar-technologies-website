<script lang="ts">
	// Privacy policy (DAR-44) — content-only legal page, /about's mold: no loader, all copy in
	// Paraglide messages, one <Seo>, the shared helix hero, and the whole document in a single
	// frosted card of LegalSection blocks. The facts stay within the settled public set (trade
	// name only, "United States", GitHub + email) and the data-flow claims mirror what the code
	// actually does — including the user-agent + hashed IP stored with contact/waitlist
	// submissions, the public (≥3-people) waitlist interest suggestions, the message→account
	// backfill, and the no-language-cookie URL locale — keep this page truthful when those
	// flows change, and bump PRIVACY_UPDATED (src/lib/legal.ts) when you do. Since DAR-121 that
	// includes a claim about mail we do NOT send: see the "How we use it" section below.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import LegalSection from '$lib/components/LegalSection.svelte';
	import TitledItems from '$lib/components/TitledItems.svelte';
	import ContactLinks from '$lib/components/ContactLinks.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { PRIVACY_UPDATED } from '$lib/legal';
</script>

<Seo title={m.privacy_page_title()} description={m.privacy_page_description()} />

<CosmicBackdrop />

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
				<TitledItems
					entries={[
						{ title: m.privacy_collect_contact_title(), body: m.privacy_collect_contact_body() },
						{ title: m.privacy_collect_waitlist_title(), body: m.privacy_collect_waitlist_body() },
						{ title: m.privacy_collect_account_title(), body: m.privacy_collect_account_body() },
						{ title: m.privacy_collect_technical_title(), body: m.privacy_collect_technical_body() }
					]}
				/>
			</LegalSection>

			<!-- Two categories, named explicitly (DAR-121). This section used to be one paragraph
			     ending "waitlist email is only about early access", which the step-1 opt-in box and
			     the collection section above both contradicted. The second item is a promise about
			     what we DON'T send: it stops being true the day a marketing sender ships, which is
			     what `email-senders.spec.ts` exists to make a declared act rather than a silent one. -->
			<LegalSection heading={m.privacy_use_heading()} body={m.privacy_use_body()}>
				<TitledItems
					entries={[
						{
							title: m.privacy_use_operational_title(),
							body: m.privacy_use_operational_body()
						},
						{ title: m.privacy_use_updates_title(), body: m.privacy_use_updates_body() }
					]}
				/>
			</LegalSection>

			<LegalSection heading={m.privacy_processors_heading()} body={m.privacy_processors_intro()}>
				<TitledItems
					entries={[
						{
							title: m.privacy_processors_cloudflare_title(),
							body: m.privacy_processors_cloudflare_body()
						},
						{ title: m.privacy_processors_turso_title(), body: m.privacy_processors_turso_body() },
						{
							title: m.privacy_processors_resend_title(),
							body: m.privacy_processors_resend_body()
						},
						{ title: m.privacy_processors_sanity_title(), body: m.privacy_processors_sanity_body() }
					]}
				/>
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
