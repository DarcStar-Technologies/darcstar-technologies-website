<script lang="ts">
	// Terms of service (DAR-44) — content-only legal page, same shell as /privacy: no loader,
	// all copy in Paraglide messages, one <Seo>, shared helix hero, one divided frosted card of
	// LegalSection blocks. Deliberately has no governing-law state clause — the settled public
	// facts pin location to "United States" only; add a state if/when the entity registers one.
	// Bump TERMS_UPDATED (src/lib/legal.ts) when the copy changes substantively.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import LegalSection from '$lib/components/LegalSection.svelte';
	import ContactLinks from '$lib/components/ContactLinks.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { TERMS_UPDATED } from '$lib/legal';
</script>

<Seo title={m.terms_page_title()} description={m.terms_page_description()} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.terms_eyebrow()}
		heading={m.terms_heading()}
		emphasis={m.terms_heading_emphasis()}
		lead={m.terms_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl">
		<p class="text-center text-xs text-muted">
			{m.legal_updated({ date: formatDate(TERMS_UPDATED, getLocale()) })}
		</p>

		<div class="glass-card mt-6 divide-y divide-hairline">
			<LegalSection heading={m.terms_agreement_heading()} body={m.terms_agreement_body()} />
			<LegalSection heading={m.terms_use_heading()} body={m.terms_use_body()} />
			<LegalSection heading={m.terms_accounts_heading()} body={m.terms_accounts_body()} />
			<LegalSection heading={m.terms_waitlist_heading()} body={m.terms_waitlist_body()} />
			<LegalSection heading={m.terms_content_heading()} body={m.terms_content_body()} />
			<LegalSection heading={m.terms_thirdparty_heading()} body={m.terms_thirdparty_body()} />
			<LegalSection heading={m.terms_disclaimer_heading()} body={m.terms_disclaimer_body()} />
			<LegalSection heading={m.terms_liability_heading()} body={m.terms_liability_body()} />
			<LegalSection heading={m.terms_changes_heading()} body={m.terms_changes_body()} />

			<LegalSection heading={m.terms_contact_heading()} body={m.terms_contact_body()}>
				<p class="mt-3 flex flex-col gap-1.5 text-sm"><ContactLinks /></p>
			</LegalSection>
		</div>
	</div>
</div>
