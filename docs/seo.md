# SEO & social cards

Every page's document head — `<title>`, meta description, canonical, and the
Open Graph + Twitter tags that make a shared link render a rich preview — comes
from **one component**: [`src/lib/components/Seo.svelte`](../src/lib/components/Seo.svelte).
Background: issue #9 (links shared to investors rendered an untitled tab and a
blank social card). Discovery surfaces — `/sitemap.xml` and JSON-LD structured
data — are DAR-48; see their sections below.

## Using it

Render **exactly one** `<Seo>` per page, in the `+page.svelte` (not the layout).
SvelteKit merges every component's `<svelte:head>`, so a copy in the layout
_plus_ a copy in the page would emit each OG tag twice. The homepage uses the
component defaults:

```svelte
<Seo />
```

Any new page must render its own `<Seo>` with page-specific copy:

```svelte
<Seo title="Careers — DarcStar Technologies" description="…≤160 chars…" path="/careers" />
```

Props (all optional): `title`, `description`, `path` (this page's own path,
root-relative, defaults to the current pathname), `canonical` (an **absolute**
URL that overrides the canonical link only — see below), `type` (`og:type`,
default `website`), `image` (root-relative, defaults to the fingerprinted OG
card), `imageAlt`, `noindex` (force it for gated pages), `jsonLd` (structured
data — see below). The site-wide default title/description live at the top of
the component.

They're declared in a `<script module>` block and **exported as `SeoProps`**, so
code that _builds_ a prop set can be checked against them (see `contentSeo()`
below). A Svelte spread silently ignores props the component doesn't declare, so
`<Seo {...obj} />` gives no such guarantee on its own.

## How the tags resolve

- **Absolute URLs** (canonical, `og:url`, `og:image`, `twitter:image`) are built
  from `page.url.origin`. On SSR that's the serving origin — `https://darcstar.tech`
  in production, which is what scrapers hit and what OG requires. Preview
  deploys therefore self-canonicalize to their own preview origin, which is fine
  (previews aren't meant to be indexed).
- **`canonical` and `og:url` are deliberately separate** (DAR-70). Both default to
  this page's own URL, but only the canonical link is overridable:
  - `<link rel="canonical">` = `canonical ?? pageUrl`. Saying "index that one
    instead of me" — a third-party paper page pointing at arXiv/the publisher.
  - `<meta property="og:url">` = `pageUrl`, **always**. This is the shared
    object's identity in the social graph; pointing it off-site would hand every
    share of our page to arXiv.

  They were one derived value until DAR-70, so an override would have moved both
  silently. Keep them apart. Note the prop conventions differ: `path` is
  root-relative, `canonical` is an **absolute** URL.

- **Locale** — `og:locale` is derived from the active Paraglide locale
  (`en`→`en_US`, `es`→`es_ES`). `og:locale:alternate` is emitted **only** for
  locales in `TRANSLATED_LOCALES` (currently `[baseLocale]`), so no alternate is
  advertised while `es` is untranslated placeholder English (issue #18).
  `TRANSLATED_LOCALES` lives in [`src/lib/seo.ts`](../src/lib/seo.ts) — it is
  shared with `/sitemap.xml`, so adding a locale there flips the OG alternates,
  the noindex, **and** the sitemap's URL set together. Extend `OG_LOCALE`
  (in `Seo.svelte`) at the same time.
- **Untranslated locales are `noindex`.** `Seo.svelte` emits
  `<meta name="robots" content="noindex, follow">` for any non-base locale until
  its `messages/<locale>.json` is real (added to `TRANSLATED_LOCALES`). `hreflang`
  alternates are deferred until then — a `TODO` in `Seo.svelte` marks where the
  reciprocal set + `x-default` go. See [i18n](i18n.md).
- **SSR is required.** Scrapers (Slack, LinkedIn, Facebook, X) don't run JS, so
  the tags must be in the server-rendered HTML — they are, because `<Seo>` renders
  during SSR. Do **not** prerender-disable or client-only these routes.

Error pages (`+error.svelte`) intentionally carry a `<title>` but
`<meta name="robots" content="noindex">` — they should never be indexed.

### CMS-driven heads: `contentSeo()` (DAR-71)

`/news/[slug]` and `/research/[slug]` do **not** hand-map the Studio's `seo`
object onto `<Seo>` props. Both call
[`contentSeo(doc.seo, fallbacks)`](../src/lib/sanity/content-seo.ts) and **spread**
the result — `<Seo {...seo} type="article" {jsonLd} />` — so every field the SEO
tab exposes is wired in exactly one place. That indirection is the fix, not
decoration: while the mapping was copy-pasted per page, the **"Hide from search
engines"** toggle (`seo.noIndex`) was fetched, typed, and then dropped at both
render sites — a control that did nothing, with no signal to the editor.

Adding a field to the Studio's `seo` object? Wire it in `contentSeo()` and extend
`content-seo.spec.ts`; never re-derive one at a call site.

Two guards, and neither covers the other's failure shape — keep both:

- `contentSeo` returns `Pick<SeoProps, …>`, so a **misnamed** key (`noIndex` for
  `noindex`) is a compile error instead of a prop the component quietly drops.
- Every `SeoProps` field is optional, so `Pick` of them is too — a key **omitted**
  entirely still type-checks. `content-seo.spec.ts` asserts each key's value,
  which is what catches that (the exact shape of the original bug).

`noIndex` composes with the locale rule (`Seo.svelte` ORs the two), and its
polarity is **fail-open**: hiding requires an explicit `true`, so unset/null — the
state of every document today — stays indexable. A hidden page is
`noindex, follow` and stays live and linked from `/news` · `/research`: the toggle
hides it from search engines, it does not unpublish it.

### Canonicalising third-party papers (DAR-70)

`/research/[slug]` reproduces a paper's `abstract` verbatim. For work that isn't
ours that's duplicate content, so the page points search engines at the original
instead of competing with it:

1. `seo.canonicalUrl` — the editor's explicit override, any document, wins.
2. Otherwise the page derives one: `paperSourceUrls(paper)[0]`
   ([`src/lib/jsonld.ts`](../src/lib/jsonld.ts)), ordered `url` → DOI → arXiv.
3. **First-party papers stay self-canonical.** Same fail-safe polarity as the rest
   of `darcstarAuthored` (DAR-52): only an explicit `true` keeps the canonical
   here, so an unset flag can never make us claim someone else's work.

`paperSourceUrls` is shared with the ScholarlyArticle node's `sameAs` — one list,
so the `doi.org`/`arxiv.org` templates exist once.

**Both inputs pass the same `isHttpUrl` gate** (absolute http(s), no embedded
whitespace). `doi`/`arxivId` are unvalidated free text in the Studio, and `new URL`
happily turns a pasted sentence into a well-formed URL that 404s; the Studio does
validate `canonicalUrl`'s scheme, but that's a UI affordance an API write skips, and
two inputs to one canonical must not carry different guarantees. An unusable
override falls **through** to the derivation rather than shadowing it — the same
shape as the image fallback. A malformed `sameAs` is merely ignored by crawlers; a
malformed canonical misdirects them, so this never emits one.

Canonicalised pages **stay in the sitemap** — the canonical tag is authoritative,
and the DarcStar `commentary` on them is original content worth crawling. The JSON-LD
`mainEntityOfPage`/`url` also stay on our page: they describe _this_ page.

## The OG image (1200×630)

Generated by [`scripts/gen-og.mjs`](../scripts/gen-og.mjs) →
`src/lib/assets/og-image.png`, which `Seo.svelte` **fingerprint-imports** (a
regenerated card gets a new hashed URL, so scrapers re-fetch instead of serving
a stale cache).

The script is the source of truth: it composes a self-contained HTML doc that
mirrors the live homepage (navbar wordmark + hero H1 + GIDE kicker) over the same
near-black void, inlines the three self-hosted variable fonts as data URIs so the
type is on-brand and offline, and screenshots it with headless Chromium
(Playwright, already a dev dep) at exactly 1200×630. PNG — not SVG — because
social scrapers largely reject SVG cards.

Colours are the one-source brand triad (charge R/G/B `#fb5a6f`/`#3ddc84`/`#48c6ef`),
which trace back to [`scripts/gen-theme.mjs`](../scripts/gen-theme.mjs); never
re-type them.

Regenerate after any wordmark/tagline/brand change:

```sh
node scripts/gen-og.mjs
```

## /sitemap.xml (DAR-48)

[`src/routes/sitemap.xml/+server.ts`](../src/routes/sitemap.xml/+server.ts)
serves the crawlable surface in one document: the `STATIC_PATHS` marketing pages
plus every routable Sanity post (`/news/[slug]`), paper (`/research/[slug]`) and
team member (`/people/[slug]`, DAR-122), fetched in one round trip by
`sitemapEntriesQuery` (slug + `_updatedAt`, which
becomes `<lastmod>`). `static/robots.txt` points crawlers at it — with the
**production URL hardcoded**, because robots.txt is a static asset that can't
know its serving origin (previews serving that line are harmless; they're not
indexed).

Design decisions to preserve:

- **Worker-rendered, never prerendered.** The URL set changes with the CMS, and
  prerendering would demote the route to the assets layer (see
  [security-headers](security-headers.md) for why pages must stay SSR).
- **Origin-relative**, like `<Seo>`'s canonical: production emits
  `https://darcstar.tech/...`, previews self-reference.
- **Exclusions are deliberate**: gated/noindex surfaces (`/admin`, `/account`,
  `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/logout`) and any
  untranslated locale tree — the sitemap loops `TRANSLATED_LOCALES`
  ([`src/lib/seo.ts`](../src/lib/seo.ts)), the same flag that noindexes `/es`.
  **Plus any post/paper the
  editor hid** — `sitemapEntriesQuery` filters `seo.noIndex != true` (DAR-71), so
  a hidden page isn't advertised to crawlers, not just noindexed once they arrive.
  `!= true` (never `== false`): GROQ's `!=` includes null, and no document sets
  `seo` at all today, so the inverse would empty the sitemap of every post and
  paper. That polarity has to match `contentSeo()`'s `=== true`; the two are
  pinned separately (`queries.spec.ts`, `content-seo.spec.ts`) because one is GROQ
  and one is TypeScript.
- **A Sanity outage degrades** to a static-pages-only sitemap plus a log line
  (same posture as the /news · /research · /people list loads) — never a 500.
- **Adding an indexable STATIC page?** Add it to `STATIC_PATHS` _and_ to
  `AUDITED_PAGES` in `security-headers.e2e.ts`. Forgetting the sitemap is
  caught automatically: `seo.e2e.ts` **enumerates** `src/routes/**/+page.svelte`
  (minus dynamic segments and the gated set) and fails if a public page is
  missing from the served sitemap — the pinned list alone couldn't detect an
  omission.
- **Adding a CMS-driven CONTENT type?** Different rules, because none of the
  above sees it. It is **two halves** — an arm in `sitemapEntriesQuery` and a
  mapping in the handler — and the second is silent when forgotten: the query
  keeps type-checking, the endpoint keeps returning 200, and the sitemap simply
  comes back a third short. CI can't catch it either: e2e runs without
  `SANITY_VIEWER_TOKEN` (DAR-96), so **every** CMS-driven `<loc>` is absent
  there and `seo.e2e.ts` would pass unchanged against a handler that dropped
  posts, papers and people on the floor. So the halves meet in
  `sitemap.xml/server.spec.ts`, which drives the real handler against a mocked
  client — table-driven, one row per type (mutation-verified: deleting the
  people mapping fails 2 tests).
- **Content DETAIL routes stay out of `AUDITED_PAGES`** — `/news/[slug]`,
  `/research/[slug]`, `/people/[slug]`. Same token reason: they all 404 in CI,
  so the audit would be proving the CSP of an error page. `seo.e2e.ts`'s
  enumeration already skips `[…]` segments, so nothing regresses.

## JSON-LD structured data (DAR-48)

Pure builders in [`src/lib/jsonld.ts`](../src/lib/jsonld.ts) (unit-tested in
`jsonld.spec.ts`), rendered as `<script type="application/ld+json">` data
blocks:

- **`Organization`** — site-wide, emitted by the **root layout** (the one
  deliberate layout-head entry; the "never in the layout" rule exists for
  duplicated OG tags, which this isn't). It carries `@id`
  `{origin}/#organization`, and every other node references it (`publisher`,
  `worksFor`) instead of re-stating the org. Facts are the settled public ones
  (`$lib/site.ts`): trade name only, United States, GitHub + `info@` email.
  **`sameAs` is the one editable part** (DAR-73): it takes the site's resolved
  social row — the same list the footer renders — so adding LinkedIn in the
  Studio adds it to the graph. It is passed **in** (`organizationJsonLd(origin,
{ sameAs })`) rather than imported, to keep this module dependency-pure;
  omitting it keeps the historical single-GitHub identity, and every URL is
  re-gated through `isHttpUrl`, because an unusable value here is published as
  the **organization's identity**, not merely a dead link. See
  [sanity.md](sanity.md#what-sitesettings-actually-drives-dar-73).
- **Per-page nodes** go through the `<Seo jsonLd={...}>` prop (an array becomes
  one `@graph` script; empty arrays render nothing): `Person` on `/people` and
  the fuller `Person` (+ `BreadcrumbList`) on `/people/[slug]`, `Article` +
  `BreadcrumbList` on `/news/[slug]`, `ScholarlyArticle` + `BreadcrumbList` on
  `/research/[slug]`
  (DOI/arXiv/publisher links ride along as `sameAs`). ScholarlyArticle claims
  the org as `publisher` **only when `darcstarAuthored`** — third-party papers
  (DAR-52, fail-safe polarity: unset → external) must not be machine-readably
  misattributed.
- **A person is identified by their profile URL** (DAR-122). Both surfaces that
  describe someone emit `@id` = `{origin}/people/{slug}`, so the grid's node and
  the detail page's are ONE entity rather than two people who share a name. It is
  derived from the slug, never from the serving URL, or a localized tree would
  mint a second entity per locale — `mainEntityOfPage` is the served URL, because
  that one describes the page. Slugless docs have no page and stay anonymous
  (no `@id`) rather than claiming one that 404s. `alumniOf` / `knowsAbout` are
  just what the Studio's `education` / `focusAreas` already are. Both Person
  builders run social links through the same `isHttpUrl` gate the org uses — it
  was truthiness-only on the grid, so the two disagreed about what a publishable
  identity is.
- **`$lib/jsonld.ts` must stay dependency-pure** (constants + one static asset):
  the root layout imports it, so anything it pulls in ships in **every** page's
  initial client bundle — an earlier draft imported the Sanity URL builder here
  and dragged `@sanity/image-url` site-wide. Image fields are pre-resolved to
  URL strings by the page that owns them, via `imageUrl(image, w, h?)` in
  [`$lib/sanity/image.ts`](../src/lib/sanity/image.ts) (which also degrades a
  malformed CMS `_ref` to "no image" instead of throwing during SSR).
- **Safety/CSP**: `jsonLdScript` escapes `<` as `\u003c`, so CMS content can't
  break out of the tag — that's why the two `{@html}` sites carry
  `eslint-disable-next-line svelte/no-at-html-tags` (don't add more without the
  same serializer). JSON-LD is a non-executable data block, so the strict
  `script-src` CSP does **not** apply (no nonce needed); the violation guard in
  `security-headers.e2e.ts` proves that on every audited page.

Validate with Google's [Rich Results Test](https://search.google.com/test/rich-results)
or the [schema.org validator](https://validator.schema.org/) against a preview
or production URL.

## Verifying

`pnpm preview` runs the built worker on the real Workers runtime; the tags are in
the SSR HTML:

```sh
curl -s http://localhost:4173/ | grep -E 'og:|twitter:|canonical|<title>'
```

(4173 is the main checkout's port; a worktree previews on
[its own](commands.md#the-preview-port-dar-79), which `pnpm preview` prints.)

Before sharing externally, validate with the platform debuggers (they force a
re-scrape): [opengraph.xyz](https://www.opengraph.xyz/),
LinkedIn Post Inspector, and the X Card validator.
