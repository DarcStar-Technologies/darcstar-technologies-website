<script lang="ts">
	// /people — the team grid (Sanity `person`, internal only). Avatar + name + role + bio + social
	// links. Chrome copy via Paraglide; person fields are CMS data rendered as `{expr}`.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import SanityImage from '$lib/components/SanityImage.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { peopleJsonLd } from '$lib/jsonld';
	import { imageUrl } from '$lib/sanity/image';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	// Person JSON-LD lives on this index (DAR-48): there are no per-person detail routes, so the
	// team grid IS each profile's canonical surface. Empty team → <Seo> emits no script at all.
	// Image URLs are resolved HERE (this page's chunk carries the Sanity URL builder anyway, for
	// the avatars) so $lib/jsonld stays out of the site-wide layout bundle — see its header note.
	const peopleGraph = $derived(
		peopleJsonLd(
			data.people.map((person) => ({ ...person, image: imageUrl(person.image, 600) })),
			page.url.origin
		)
	);
</script>

<Seo title={m.people_page_title()} description={m.people_page_description()} jsonLd={peopleGraph} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.people_eyebrow()}
		heading={m.people_heading()}
		emphasis={m.people_heading_emphasis()}
		lead={m.people_lead()}
	/>

	<div class="mx-auto w-full max-w-4xl">
		{#if data.people.length === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.people_empty()}</p>
		{:else}
			<ul class="grid gap-6 sm:grid-cols-2">
				{#each data.people as person (person._id)}
					<li class="glass-card flex flex-col items-center p-8 text-center">
						{#if person.image?.asset}
							<SanityImage
								image={person.image}
								width={192}
								height={192}
								alt={person.image.alt ?? person.name}
								class="size-24 rounded-full border border-hairline object-cover"
							/>
						{/if}
						<h2 class="mt-4 text-lg font-medium tracking-tight text-white">{person.name}</h2>
						{#if person.role}
							<p class="mt-0.5 text-sm text-primary-400">{person.role}</p>
						{/if}
						{#if person.bio}
							<p class="mt-3 text-sm leading-relaxed text-body">{person.bio}</p>
						{/if}
						{#if person.socialLinks && person.socialLinks.length > 0}
							<div class="mt-4 flex flex-wrap justify-center gap-3">
								{#each person.socialLinks as link (link.url)}
									<a
										href={link.url}
										target="_blank"
										rel="noreferrer noopener"
										class="text-xs font-medium text-primary-500 transition-colors hover:text-primary-400"
										>{link.label}</a
									>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
