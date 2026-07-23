<script lang="ts">
	// /news — the published-post feed (Sanity `post`). Cards link to /news/[slug]. Chrome copy is
	// Paraglide `m.*`; the post title/excerpt/authors/date are CMS data rendered as `{expr}` (exempt
	// from no-raw-text). Matches the site aesthetic: CosmicBackdrop + the shared helix hero + glass.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import SanityImage from '$lib/components/SanityImage.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<Seo title={m.news_page_title()} description={m.news_page_description()} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero eyebrow={m.news_eyebrow()} heading={m.news_heading()} lead={m.news_lead()} />

	<div class="mx-auto w-full max-w-3xl">
		{#if data.posts.length === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.news_empty()}</p>
		{:else}
			<ul class="space-y-6">
				{#each data.posts as post (post._id)}
					<li>
						<a
							href={localizeHref(`/news/${post.slug}`)}
							class="glass-card group flex flex-col overflow-hidden transition-colors hover:border-primary-500/40 sm:flex-row"
						>
							{#if post.coverImage?.asset}
								<div class="shrink-0 overflow-hidden sm:w-56">
									<SanityImage
										image={post.coverImage}
										width={448}
										height={280}
										alt={post.coverImage.alt ?? ''}
										class="h-44 w-full object-cover sm:h-full"
									/>
								</div>
							{/if}
							<div class="flex flex-1 flex-col p-6 sm:p-7">
								<div class="flex flex-wrap items-center gap-x-3 text-xs text-muted">
									<time datetime={post.publishedAt}
										>{formatDate(post.publishedAt, getLocale())}</time
									>
									{#if post.authors && post.authors.length > 0}
										<span aria-hidden="true">·</span>
										<span>{m.content_by()} {post.authors.map((a) => a.name).join(', ')}</span>
									{/if}
								</div>
								<h2
									class="mt-2 text-xl font-medium tracking-tight text-white transition-colors group-hover:text-primary-400"
								>
									{post.title}
								</h2>
								{#if post.excerpt}
									<p class="mt-2 line-clamp-3 text-sm leading-relaxed text-body">{post.excerpt}</p>
								{/if}
								<span class="mt-4 text-sm font-medium text-primary-500"
									>{m.news_read_article()}</span
								>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
