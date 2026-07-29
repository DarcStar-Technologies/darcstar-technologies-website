<script lang="ts">
	// /news — the published-post feed (Sanity `post`). Cards link to /news/[slug]. Chrome copy is
	// Paraglide `m.*`; the post title/excerpt/authors/date are CMS data rendered as `{expr}` (exempt
	// from no-raw-text). Matches the site aesthetic: CosmicBackdrop + the shared helix hero + glass.
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import PageHero from '$lib/components/PageHero.svelte';
	import SanityImage from '$lib/components/SanityImage.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/sanity/date';
	import { contentPath } from '$lib/content-path';
	import { page } from '$app/state';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<Seo title={m.news_page_title()} description={m.news_page_description()} />

<CosmicBackdrop />

<div class="space-y-14">
	<PageHero
		eyebrow={m.news_eyebrow()}
		heading={m.news_heading()}
		emphasis={m.news_heading_emphasis()}
		lead={m.news_lead()}
	/>

	<div class="mx-auto w-full max-w-3xl space-y-8">
		{#if data.total === 0}
			<p class="glass-card px-8 py-12 text-center text-sm text-body">{m.news_empty()}</p>
		{:else}
			<ul class="space-y-6">
				{#each data.posts as post (post._id)}
					{@const path = contentPath('/news', post.slug)}
					<li>
						<!-- The whole card is the link — when the slug names a page `[slug]` cannot serve
						     (DAR-148: `../admin` resolves out of the section), it degrades to a plain <div>
						     and gives up BOTH affordances that promise a destination: the hover treatment
						     and the "Read article" call to action below. A card that still says "Read
						     article" and goes nowhere is a worse lie than the link was. The post keeps its
						     card rather than vanishing from the feed, so a broken slug is debuggable. -->
						<svelte:element
							this={path ? 'a' : 'div'}
							href={path ? localizeHref(path) : undefined}
							class={[
								'glass-card flex flex-col overflow-hidden sm:flex-row',
								path && 'group transition-colors hover-focus:border-primary-500/40'
							]}
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
									class="mt-2 text-xl font-medium tracking-tight text-white transition-colors group-hover-focus:text-primary-400"
								>
									{post.title}
								</h2>
								{#if post.excerpt}
									<p class="mt-2 line-clamp-3 text-sm leading-relaxed text-body">{post.excerpt}</p>
								{/if}
								{#if path}
									<span class="mt-4 text-sm font-medium text-primary-500"
										>{m.news_read_article()}</span
									>
								{/if}
							</div>
						</svelte:element>
					</li>
				{/each}
			</ul>

			<Pager page={data.page} pageCount={data.pageCount} url={page.url} />
		{/if}
	</div>
</div>
