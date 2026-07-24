import { CONTACT_EMAIL, GITHUB_URL, SITE_NAME } from '$lib/site';
// Fingerprint-imported like Seo.svelte's OG card: a regenerated mark gets a new hashed URL.
// The SVG is the actual brand mark; swap for a raster square if Google ever balks at vector.
import logoAsset from '$lib/assets/favicon.svg';

// JSON-LD structured data (DAR-48). Pure builders — each returns a schema.org node WITHOUT
// `@context`; `jsonLdScript` adds it (single node) or wraps several in `@graph` (one <script>
// per page keeps the head tidy). Builders take the serving `origin` explicitly — same
// convention as Seo.svelte's canonical: production absolutizes to https://darcstar.tech,
// previews self-reference (they're noindex, so it never matters).
//
// Sanity-derived fields arrive as `T | null` (TypeGen nullability), so inputs are structural
// least-requirements — pass the query results straight in; nullish fields serialize away
// (JSON.stringify drops `undefined` object values).
//
// This module must stay DEPENDENCY-PURE (constants + a static asset only): the root layout
// imports it, so anything it pulls in rides in every page's initial client bundle. That is why
// image fields arrive as pre-resolved URL strings ($lib/sanity/image.ts's imageUrl, built by
// the pages that have images) instead of this module importing the Sanity URL builder.

/** Node an @id-reference points at — emitted site-wide by the root layout. */
export function organizationId(origin: string): string {
	return `${origin}/#organization`;
}

/**
 * Serialize node(s) into a `<script type="application/ld+json">` tag for `{@html}` in a head.
 * `<` is escaped to the `\u003c` JSON escape (identical parse) so content containing `</script>`
 * or `<!--` can't terminate the tag early — the one injection vector of inline JSON scripts.
 * JSON-LD is a data block (not a valid script MIME type), so the browser never executes it
 * and CSP `script-src` doesn't apply — no nonce needed; the CSP e2e guard proves it.
 */
export function jsonLdScript(data: object | object[]): string {
	// A page whose entity list is data-driven (e.g. /people with an empty team) yields an empty
	// array — render nothing at all rather than a hollow {"@graph":[]} script. Living HERE (not
	// in a caller) covers every consumer by construction.
	if (Array.isArray(data) && data.length === 0) return '';
	const payload = Array.isArray(data)
		? { '@context': 'https://schema.org', '@graph': data }
		: // Node spread FIRST so the wrapper's @context always wins — the whole contract of this
			// function is that the emitted script is schema.org-contexted.
			{ ...data, '@context': 'https://schema.org' };
	const json = JSON.stringify(payload).replace(/</g, '\\u003c');
	return `<script type="application/ld+json">${json}</script>`;
}

// The settled public facts (see $lib/site.ts + the About/Footer copy): trade name only —
// no legal suffix — located in the United States, reachable via GitHub + the info@ alias.
export function organizationJsonLd(origin: string) {
	return {
		'@type': 'Organization',
		'@id': organizationId(origin),
		name: SITE_NAME,
		url: `${origin}/`,
		// URL-join, not string-concat: Vite emits the import as a root-relative path today
		// (favicon.svg > the 4096-byte inline limit), but if the asset ever shrinks it becomes a
		// data: URI — new URL() keeps an absolute (incl. data:) href intact instead of producing
		// "https://origindata:image/svg+xml,…".
		logo: new URL(logoAsset, origin).href,
		email: CONTACT_EMAIL,
		sameAs: [GITHUB_URL],
		address: { '@type': 'PostalAddress', addressCountry: 'US' }
	};
}

interface PersonInput {
	name: string | null;
	role?: string | null;
	/** Pre-resolved absolute image URL (build with image.ts's `imageUrl`) — see the
	 * dependency-purity note at the top of this module. */
	image?: string | null;
	socialLinks?: { label: string | null; url: string | null }[] | null;
}

/**
 * Person nodes for the /people team grid (there are no per-person detail routes — the index
 * IS the profile surface). Name-less docs are dropped: a Person without a name is noise.
 */
export function peopleJsonLd(people: PersonInput[], origin: string) {
	return people
		.filter((person): person is PersonInput & { name: string } => Boolean(person.name))
		.map((person) => ({
			'@type': 'Person',
			name: person.name,
			jobTitle: person.role ?? undefined,
			image: person.image ?? undefined,
			sameAs: nonEmpty(person.socialLinks?.map((link) => link.url).filter(isTruthy)),
			worksFor: { '@id': organizationId(origin) }
		}));
}

interface AuthorInput {
	name: string | null;
}

interface ArticleInput {
	title: string | null;
	excerpt?: string | null;
	publishedAt?: string | null;
	_updatedAt?: string | null;
	authors?: AuthorInput[] | null;
}

/** Article node for a /news/[slug] post. `url` is the page's canonical; `image` the resolved
 * social-card URL the page already derives for <Seo> (absolute Sanity CDN or undefined). */
export function articleJsonLd(post: ArticleInput, opts: { url: string; image?: string }) {
	const origin = new URL(opts.url).origin;
	return {
		'@type': 'Article',
		headline: post.title ?? undefined,
		description: post.excerpt ?? undefined,
		datePublished: post.publishedAt ?? undefined,
		dateModified: post._updatedAt ?? undefined,
		image: opts.image,
		author: authorNodes(post.authors),
		publisher: { '@id': organizationId(origin) },
		mainEntityOfPage: opts.url,
		url: opts.url
	};
}

interface PaperInput {
	title: string | null;
	abstract?: string | null;
	publishedDate?: string | null;
	_updatedAt?: string | null;
	authors?: AuthorInput[] | null;
	url?: string | null;
	doi?: string | null;
	arxivId?: string | null;
	darcstarAuthored?: boolean | null;
}

/** ScholarlyArticle node for a /research/[slug] paper. External identities (publisher page,
 * DOI, arXiv) go in `sameAs` — the mainEntityOfPage stays OUR detail page. The org is claimed
 * as `publisher` ONLY for first-party papers: /research also lists foundational third-party
 * work (DAR-52), and machine-readable misattribution would be worse than the visible-copy kind
 * that issue fixed. Same fail-safe polarity: unset/null `darcstarAuthored` → no claim. */
export function scholarlyArticleJsonLd(paper: PaperInput, opts: { url: string }) {
	const origin = new URL(opts.url).origin;
	return {
		'@type': 'ScholarlyArticle',
		headline: paper.title ?? undefined,
		abstract: paper.abstract ?? undefined,
		datePublished: paper.publishedDate ?? undefined,
		dateModified: paper._updatedAt ?? undefined,
		author: authorNodes(paper.authors),
		publisher: paper.darcstarAuthored ? { '@id': organizationId(origin) } : undefined,
		mainEntityOfPage: opts.url,
		url: opts.url,
		sameAs: nonEmpty(
			[
				paper.url,
				paper.doi ? `https://doi.org/${paper.doi}` : undefined,
				paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : undefined
			].filter(isTruthy)
		)
	};
}

/** BreadcrumbList for detail pages: pass ordered `{ name, url }` crumbs, home first. Nameless
 * crumbs (a nullable CMS title) are dropped and positions renumbered — ListItem requires name. */
export function breadcrumbJsonLd(items: { name: string | null | undefined; url: string }[]) {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: items
			.filter((item): item is { name: string; url: string } => Boolean(item.name))
			.map((item, index) => ({
				'@type': 'ListItem',
				position: index + 1,
				name: item.name,
				item: item.url
			}))
	};
}

function authorNodes(authors: AuthorInput[] | null | undefined) {
	return nonEmpty(
		(authors ?? [])
			.filter((author): author is { name: string } => Boolean(author.name))
			.map((author) => ({ '@type': 'Person', name: author.name }))
	);
}

function isTruthy<T>(value: T | null | undefined | false | ''): value is T {
	return Boolean(value);
}

/** Collapse empty arrays to `undefined` so they serialize away entirely. */
function nonEmpty<T>(values: T[] | undefined): T[] | undefined {
	return values && values.length > 0 ? values : undefined;
}
