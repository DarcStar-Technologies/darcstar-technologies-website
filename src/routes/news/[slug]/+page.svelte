<script lang="ts">
	// /news/[slug] — a single post: helix hero with the title, meta, cover image, the Portable Text
	// body (PortableBody), and any related papers. `data.post` is non-null here (the load 404s a
	// missing slug, which narrows the type). SEO title/description/OG-image derive from the post's
	// `seo` field, falling back to its excerpt/cover and finally the site defaults.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import SanityImage from '$lib/components/SanityImage.svelte';
	import PortableBody from '$lib/components/portable/PortableBody.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { ogImageUrl } from '$lib/sanity/image';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const post = $derived(data.post);

	const seoTitle = $derived(post.seo?.metaTitle ?? m.content_doc_title({ title: post.title }));
	const seoDescription = $derived(post.seo?.metaDescription ?? post.excerpt ?? undefined);
	const seoImage = $derived(ogImageUrl(post.seo?.ogImage ?? post.coverImage));
</script>

<Seo title={seoTitle} description={seoDescription} type="article" image={seoImage} />

<CosmicBackdrop />

<article class="space-y-12">
	<PageHero eyebrow={m.news_eyebrow()} heading={post.title} lead={post.excerpt ?? undefined} />

	<div class="mx-auto w-full max-w-3xl space-y-8">
		<div class="flex flex-col gap-4">
			<a
				href={localizeHref('/news')}
				class="text-sm font-medium text-primary-500 transition-colors hover:text-primary-400"
				>{m.news_back()}</a
			>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
				<time datetime={post.publishedAt}>{formatDate(post.publishedAt, getLocale())}</time>
				{#if post.authors && post.authors.length > 0}
					<span aria-hidden="true">·</span>
					<span>{m.content_by()} {post.authors.map((a) => a.name).join(', ')}</span>
				{/if}
			</div>
			{#if post.categories && post.categories.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each post.categories as cat (cat._id)}
						<span class="rounded-full border border-hairline px-3 py-1 text-xs text-body"
							>{cat.title}</span
						>
					{/each}
				</div>
			{/if}
		</div>

		{#if post.coverImage}
			<SanityImage
				image={post.coverImage}
				width={896}
				alt={post.coverImage.alt ?? ''}
				class="w-full rounded-2xl border border-hairline"
			/>
		{/if}

		<div class="glass-card p-8 sm:p-10">
			<PortableBody value={post.body} />
		</div>

		{#if post.relatedPapers && post.relatedPapers.length > 0}
			<section class="glass-card p-8 sm:p-10">
				<h2 class="text-lg font-medium tracking-tight text-white">{m.news_related_heading()}</h2>
				<ul class="mt-4 space-y-2">
					{#each post.relatedPapers as paper (paper._id)}
						{#if paper.slug}
							<li>
								<a
									href={localizeHref(`/research/${paper.slug}`)}
									class="text-sm text-primary-500 transition-colors hover:text-primary-400 hover:underline"
								>
									{paper.title}{#if paper.venue}<span class="text-muted">
											· {paper.venue}</span
										>{/if}
								</a>
							</li>
						{/if}
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</article>
