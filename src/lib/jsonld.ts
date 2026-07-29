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
//
// `sameAs` — the org's other identities on the web — is the one part an editor controls: it takes
// the site's resolved social row (DAR-73, from `siteSettings.socialLinks` via the root layout), so
// adding LinkedIn in the Studio adds it to the graph. Passed IN rather than imported, because this
// module must stay dependency-pure (the root layout imports it, so anything it pulls in rides in
// every page's initial bundle) — same reason image fields arrive as pre-resolved URL strings.
// Omitting the option keeps the historical single-GitHub node, so a caller that has no CMS data
// (or a test) still emits something correct rather than an org with no identities.
export function organizationJsonLd(origin: string, opts: { sameAs?: string[] } = {}) {
	// Re-gated even though `resolveSocialLinks` already did: this is a public parameter, and an
	// unusable URL here is published as the ORGANIZATION's identity, not just a dead footer button.
	const sameAs = nonEmpty(opts.sameAs?.filter(isHttpUrl)) ?? [GITHUB_URL];
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
		sameAs,
		address: { '@type': 'PostalAddress', addressCountry: 'US' }
	};
}

interface PersonInput {
	name: string | null;
	slug?: string | null;
	role?: string | null;
	/** Pre-resolved absolute image URL (build with image.ts's `imageUrl`) — see the
	 * dependency-purity note at the top of this module. */
	image?: string | null;
	socialLinks?: { label: string | null; url: string | null }[] | null;
}

/**
 * The URL that IDENTIFIES a person — their /people/[slug] profile (DAR-122).
 *
 * Both surfaces that describe a person emit this as `@id`, so the team grid's node and the profile
 * page's node are one entity in a consumer's graph rather than two people who happen to share a name.
 * A person with no routable slug has no page, so they stay an anonymous (id-less) node on the grid.
 *
 * Not localized: `@id` is an identifier, and the same person must not become two entities because a
 * crawler arrived through a translated tree.
 *
 * URL-JOINED, not string-concatenated — the same reason the org's `logo` is, one screen up. Both the
 * grid's href and the sitemap's `<loc>` reach the browser through `new URL`, which percent-encodes;
 * a raw template would make this identifier the one spelling of the three that disagrees, which is
 * precisely what an `@id` cannot afford to be.
 */
function personId(slug: string | null | undefined, origin: string): string | undefined {
	return slug ? new URL(`/people/${slug}`, origin).href : undefined;
}

/**
 * Where a person's other identities live. Gated through `isHttpUrl` for the same reason
 * `organizationJsonLd` gates the org's: this is published as someone's identity on the web, and the
 * Studio's `rule.uri` is a UI affordance an API write skips (DAR-70). A malformed entry is dropped
 * rather than emitted — a `sameAs` pointing somewhere wrong is worse than one absent.
 */
function personSameAs(links: PersonInput['socialLinks']): string[] | undefined {
	return nonEmpty(
		links
			?.map((link) => link.url)
			.filter(isTruthy)
			.filter(isHttpUrl)
	);
}

/**
 * Person nodes for the /people team grid. Name-less docs are dropped: a Person without a name is
 * noise. The full profile — biography, credentials, focus areas — is emitted by the detail page
 * below; these are the same entities seen from the index, which is what `@id` says.
 */
export function peopleJsonLd(people: PersonInput[], origin: string) {
	return people
		.filter((person): person is PersonInput & { name: string } => Boolean(person.name))
		.map((person) => ({
			'@type': 'Person',
			'@id': personId(person.slug, origin),
			url: personId(person.slug, origin),
			name: person.name,
			jobTitle: person.role ?? undefined,
			image: person.image ?? undefined,
			sameAs: personSameAs(person.socialLinks),
			worksFor: { '@id': organizationId(origin) }
		}));
}

// `image` is dropped rather than inherited: the grid builder takes a pre-resolved URL as a FIELD
// (it maps a list, so there is nowhere else to put it), while a detail page has exactly one subject
// and passes it in `opts` — the shape articleJsonLd and scholarlyArticleJsonLd already use. Omitting
// it means the profile page can hand this builder its raw query result unspread, and a stray Sanity
// image object in the `image` slot stays a compile error rather than a `[object Object]` in the graph.
interface PersonProfileInput extends Omit<PersonInput, 'image'> {
	bio?: string | null;
	focusAreas?: string[] | null;
	education?: { institution: string | null }[] | null;
}

/**
 * The full Person node for a /people/[slug] profile (DAR-122) — the same entity the grid points at
 * (`@id`), with the background fields only this page renders.
 *
 * `alumniOf` and `knowsAbout` are the schema.org properties the Studio's `education` and `focusAreas`
 * already ARE; mapping them costs nothing and is the machine-readable half of what the page shows.
 * Institutions are emitted as bare `EducationalOrganization` nodes with no `@id` — we know their
 * names, not their canonical identifiers, and inventing one would assert a link we can't back.
 *
 * `url` is derived from the slug rather than taken from `opts.url`, so it stays this person's
 * identity even when a localized tree serves the page — the same reason `@id` is un-localized.
 * `mainEntityOfPage` IS the serving URL: that describes the page, not the person.
 */
export function personJsonLd(person: PersonProfileInput, opts: { url: string; image?: string }) {
	const origin = new URL(opts.url).origin;
	return {
		'@type': 'Person',
		'@id': personId(person.slug, origin),
		url: personId(person.slug, origin),
		name: person.name ?? undefined,
		jobTitle: person.role ?? undefined,
		description: person.bio ?? undefined,
		image: opts.image,
		sameAs: personSameAs(person.socialLinks),
		knowsAbout: nonEmpty(person.focusAreas?.filter(isTruthy)),
		alumniOf: nonEmpty(
			(person.education ?? [])
				.map((credential) => credential.institution)
				.filter(isTruthy)
				.map((institution) => ({ '@type': 'EducationalOrganization', name: institution }))
		),
		worksFor: { '@id': organizationId(origin) },
		mainEntityOfPage: opts.url
	};
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

/**
 * Where a paper lives upstream, most authoritative first: the publisher/landing `url`, then the
 * DOI (the version of record), then arXiv (usually the preprint). Two consumers, one list — the
 * `sameAs` below, and `/research/[slug]`'s canonical fallback (DAR-70). Keeping the doi.org and
 * arxiv.org templates in a single place is the point; a second copy is the drift DAR-71 removed.
 *
 * Entries that aren't absolute http(s) URLs are dropped. `doi` and `arxivId` are unvalidated
 * free text in the Studio (only `url` carries `rule.uri(...)`), and the canonical consumer makes
 * that matter: a malformed `sameAs` is ignored by crawlers, a malformed canonical actively points
 * them somewhere wrong. Degrade to "no URL" rather than emit garbage — the posture imageUrl takes
 * with a broken asset ref.
 */
export function paperSourceUrls(paper: Pick<PaperInput, 'url' | 'doi' | 'arxivId'>): string[] {
	const doi = paper.doi?.trim();
	const arxivId = paper.arxivId?.trim();
	return [
		paper.url?.trim(),
		doi ? `https://doi.org/${doi}` : undefined,
		arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined
	]
		.filter(isTruthy)
		.filter(isHttpUrl);
}

/**
 * What `/research/[slug]` should canonicalise to, or `undefined` to stay self-canonical (DAR-70).
 * A third-party page quotes the source's abstract verbatim, so it points at the original rather
 * than competing with it for that text; our own work keeps the canonical here.
 *
 * **Fail-safe polarity**, the same one `darcstarAuthored` carries everywhere else (DAR-52): only an
 * explicit `true` is treated as ours. An unset or null flag — the default for a hastily-added
 * document — canonicalises AWAY, so the failure mode is "we under-claim our own page", never "we
 * claim someone else's work". Lives here rather than inline in the page so that polarity is
 * unit-testable; the inline version was invisible to every test.
 */
export function paperCanonicalUrl(
	paper: Pick<PaperInput, 'url' | 'doi' | 'arxivId' | 'darcstarAuthored'>
): string | undefined {
	if (paper.darcstarAuthored === true) return undefined;
	return paperSourceUrls(paper)[0];
}

/** ScholarlyArticle node for a /research/[slug] paper. External identities (publisher page,
 * DOI, arXiv) go in `sameAs` — the mainEntityOfPage stays OUR detail page, and so does `url`:
 * both describe THIS page, even when the canonical points at the source (DAR-70). The org is
 * claimed as `publisher` ONLY for first-party papers: /research also lists foundational
 * third-party work (DAR-52), and machine-readable misattribution would be worse than the
 * visible-copy kind that issue fixed. Same fail-safe polarity: unset/null `darcstarAuthored`
 * → no claim. */
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
		sameAs: nonEmpty(paperSourceUrls(paper))
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

/** Absolute http(s), no embedded whitespace. Both halves earn their place: `new URL` rejects a
 * relative path or a bare `10.1000/xyz`, but happily ACCEPTS `mailto:`/`javascript:` (hence the
 * protocol gate) and silently percent-encodes spaces — so a `doi` field someone pasted a sentence
 * into becomes a perfectly well-formed URL pointing at a 404. No URL, DOI, or arXiv ID contains
 * whitespace, so rejecting it costs nothing and catches the realistic editor slip.
 *
 * Exported for `$lib/sanity/content-seo.ts`, which gates the editor's `seo.canonicalUrl` through
 * the SAME check — otherwise the two inputs to one canonical would carry different guarantees. */
export function isHttpUrl(value: string): boolean {
	if (/\s/.test(value)) return false;
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

/** Collapse empty arrays to `undefined` so they serialize away entirely. */
function nonEmpty<T>(values: T[] | undefined): T[] | undefined {
	return values && values.length > 0 ? values : undefined;
}
