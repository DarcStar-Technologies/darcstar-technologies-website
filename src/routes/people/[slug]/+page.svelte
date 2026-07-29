<script lang="ts">
	// /people/[slug] — one team member's profile (DAR-122): helix hero with their name, the avatar +
	// role + social row, the authored `fullBio` as Portable Text, then focus areas, responsibilities,
	// positions and credentials. `data.person` is non-null (the load 404s a missing slug).
	//
	// Every section is data-gated. The Studio has five optional background fields and only one person
	// fills most of them, so a profile with nothing but a name renders as hero + back link rather than
	// a run of empty headings.
	//
	// `person` carries no `seo` object (the Studio's SEO tab is a post/paper field), so the head is
	// built from the profile itself rather than through contentSeo().
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import SanityImage from '$lib/components/SanityImage.svelte';
	import PortableBody from '$lib/components/portable/PortableBody.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { ogImageUrl, imageUrl } from '$lib/sanity/image';
	import { breadcrumbJsonLd, isHttpUrl, personJsonLd } from '$lib/jsonld';
	import { page } from '$app/state';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const person = $derived(data.person);

	// The one-sentence `bio` is the natural meta description; the templated fallback only fires for a
	// person with a role and no bio, and a profile with neither falls through to the site default.
	const description = $derived(
		person.bio ??
			(person.role
				? m.person_page_description({ name: person.name, role: person.role })
				: undefined)
	);

	const pageUrl = $derived(page.url.origin + page.url.pathname);
	// The social card is the person's own portrait, cropped to 1200×630 around the hotspot the editor
	// set. No image → <Seo> serves the brand card, exactly as a post without a cover does.
	const jsonLd = $derived([
		personJsonLd(person, { url: pageUrl, image: imageUrl(person.image, 600) }),
		breadcrumbJsonLd([
			{ name: m.footer_nav_home(), url: page.url.origin + localizeHref('/') },
			{ name: m.nav_people(), url: page.url.origin + localizeHref('/people') },
			{ name: person.name, url: pageUrl }
		])
	]);

	/** "2015–2019", "2025–Present", or the single year we have. Undefined when the position has neither
	 * — both years are optional in the Studio, and a dangling en dash reads as a typo. */
	function yearRange(start: number | null, end: number | null): string | undefined {
		if (start === null) return end === null ? undefined : String(end);
		return `${start}–${end ?? m.person_present()}`;
	}
</script>

<Seo
	title={m.content_doc_title({ title: person.name })}
	{description}
	image={ogImageUrl(person.image)}
	imageAlt={person.image?.alt ?? person.name}
	type="profile"
	{jsonLd}
/>

<CosmicBackdrop />

<article class="space-y-12">
	<PageHero eyebrow={m.people_eyebrow()} heading={person.name} lead={person.bio ?? undefined} />

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<div class="flex flex-col gap-6">
			<a
				href={localizeHref('/people')}
				class="text-sm font-medium text-primary-500 transition-colors hover-focus:text-primary-400"
				>{m.person_back()}</a
			>
			<div class="flex flex-wrap items-center gap-5">
				{#if person.image?.asset}
					<SanityImage
						image={person.image}
						width={256}
						height={256}
						alt={person.image.alt ?? person.name}
						class="size-28 rounded-full border border-hairline object-cover"
					/>
				{/if}
				<div class="flex flex-col gap-2">
					{#if person.role}
						<p class="text-sm text-primary-400">{person.role}</p>
					{/if}
					{#if person.socialLinks && person.socialLinks.length > 0}
						<div class="flex flex-wrap gap-3">
							{#each person.socialLinks as link (link.url)}
								<a
									href={link.url}
									target="_blank"
									rel="noreferrer noopener"
									class="text-xs font-medium text-primary-500 transition-colors hover-focus:text-primary-400"
									>{link.label}</a
								>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>

		{#if person.fullBio && person.fullBio.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<PortableBody value={person.fullBio} />
			</section>
		{/if}

		{#if person.focusAreas && person.focusAreas.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">{m.person_focus_heading()}</h2>
				<ul class="mt-4 flex flex-wrap gap-2">
					{#each person.focusAreas as area (area)}
						<li class="rounded-full border border-hairline px-3 py-1 text-xs text-body">{area}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if person.responsibilities && person.responsibilities.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">
					{m.person_responsibilities_heading()}
				</h2>
				<ul class="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-body">
					{#each person.responsibilities as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if person.experience && person.experience.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">
					{m.person_experience_heading()}
				</h2>
				<!-- Ordered: the Studio's array order is newest-first and carries meaning. -->
				<ol class="mt-6 space-y-6">
					{#each person.experience as position (position._key)}
						{@const years = yearRange(position.startYear, position.endYear)}
						<li class="border-l border-hairline pl-5">
							<h3 class="text-sm font-medium text-white">{position.title}</h3>
							<p class="mt-0.5 text-xs text-muted">
								<!-- The organization's own site, when an editor supplied one. Gated like every
								     other CMS URL on the site: the Studio's url validation is a UI affordance an
								     API write skips (DAR-70), and an unusable value degrades to plain text. -->
								{#if position.url && isHttpUrl(position.url)}
									<a
										href={position.url}
										target="_blank"
										rel="noreferrer noopener"
										class="text-primary-500 transition-colors hover-focus:text-primary-400"
										>{position.organization}</a
									>
								{:else}{position.organization}{/if}{#if years}
									<span aria-hidden="true">·</span> {years}{/if}
							</p>
							{#if position.summary}
								<p class="mt-2 text-sm leading-relaxed text-body">{position.summary}</p>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if person.education && person.education.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">
					{m.person_education_heading()}
				</h2>
				<ul class="mt-4 space-y-3">
					{#each person.education as credential (credential._key)}
						<li>
							<p class="text-sm font-medium text-white">{credential.qualification}</p>
							<p class="mt-0.5 text-xs text-muted">
								{credential.institution}{#if credential.year}
									<span aria-hidden="true">·</span> {credential.year}{/if}
							</p>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</article>
