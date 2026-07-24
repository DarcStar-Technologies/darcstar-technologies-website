<script lang="ts">
	// External-link row for a Sanity `paper`: arXiv (from arxivId), DOI (from doi), a hosted PDF, the
	// code repo, and the canonical publisher URL — only the ones present render. Shared by the
	// /research list + detail. All links are external → new tab with a safe `rel`.
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		arxivId?: string | null;
		doi?: string | null;
		codeUrl?: string | null;
		url?: string | null;
		pdfUrl?: string | null;
	}
	let { arxivId, doi, codeUrl, url, pdfUrl }: Props = $props();

	type Link = { label: string; href: string };
	// `arxivId`/`doi` are bare identifiers per the schema (e.g. "2406.03482", "10.1000/xyz"), but an
	// editor may paste a full URL instead — if so, use it as-is rather than double-prefixing it.
	const idUrl = (base: string, id: string) => (/^https?:\/\//i.test(id) ? id : base + id.trim());
	const links = $derived.by(() => {
		const out: Link[] = [];
		if (arxivId)
			out.push({ label: m.research_link_arxiv(), href: idUrl('https://arxiv.org/abs/', arxivId) });
		if (doi) out.push({ label: m.research_link_doi(), href: idUrl('https://doi.org/', doi) });
		if (pdfUrl) out.push({ label: m.research_link_pdf(), href: pdfUrl });
		if (codeUrl) out.push({ label: m.research_link_code(), href: codeUrl });
		if (url) out.push({ label: m.research_link_url(), href: url });
		return out;
	});
</script>

<!-- Primary (B) accent + the ↗ glyph so these read as outbound links at a glance. The REST
     fill (bg-primary-500/10) is load-bearing: PaperStatus's "published" tone shares these
     border/text tokens, so filled = actionable link, outline-only = status chip. -->
{#if links.length > 0}
	<div class="flex flex-wrap gap-2">
		{#each links as link (link.label)}
			<a
				href={link.href}
				target="_blank"
				rel="noreferrer noopener"
				class="inline-flex items-center gap-1 rounded-full border border-primary-500/40 bg-primary-500/10 px-3 py-1 text-xs font-medium text-primary-400 transition-colors hover:border-primary-400 hover:bg-primary-500/20 hover:text-primary-300"
			>
				{link.label}<span aria-hidden="true">↗</span>
			</a>
		{/each}
	</div>
{/if}
