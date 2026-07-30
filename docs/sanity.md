# Sanity CMS — content feed (DAR-14)

The marketing site renders published content from the DarcStar **Sanity** project (`8v6ikhvv`,
Studio "DarcStar GIDE"). Three public surfaces read the `production` dataset at request time (SSR on
Cloudflare Workers): **`/news`** (posts), **`/research`** (papers), **`/people`** (team).

Everything lives under `src/lib/sanity/` (framework-agnostic bits) + `src/lib/server/sanity.ts` (the
tokened client) + `src/lib/components/portable/` (Portable Text) + the three route trees.

## Access model — why there's a read token

The `production` dataset's ACL is nominally **public**, but the project has **document-level access
control**: an anonymous (token-less) request sees **only `siteSettings`** — the `post` / `paper` /
`person` documents (all genuinely published, no drafts) are **not readable without authentication**.
So reads carry a **Sanity read/viewer token**.

- **`src/lib/server/sanity.ts`** — `getSanityClient()`: a lazy singleton (mirrors `getDb()`/
  `getAuth()`) built from `createClient({ projectId, dataset, apiVersion, useCdn: false,
perspective: 'published', token })`, where `token = readEnv('SANITY_VIEWER_TOKEN')`. It lives in
  `$lib/server` so the token **never** reaches the browser, and is imported only by `+page.server.ts`
  loads. No token (a dev checkout without it) → reads return only public docs and the pages show
  empty states, rather than throwing.
- **`src/lib/sanity/config.ts`** — `projectId` / `dataset` / `apiVersion` are **public** (visible in
  every asset URL), NOT secrets, and **build-time configurable** via `VITE_SANITY_*` env vars
  (`import.meta.env`, inlined by Vite into both bundles) with the current values as defaults. See
  "Configuring the dataset" below.

> Alternative considered: open document-level read permissions in Sanity so the content is publicly
> readable (no token, matching DAR-14's original premise). We chose the token instead to render
> content immediately without changing the CMS security posture. If the permissions are later opened,
> `getSanityClient()` still works token-less.

## GROQ + TypeGen (typed queries)

- **`src/lib/sanity/queries.ts`** — every query is a `defineQuery(...)` string (from `groq`).
  Projections flatten `slug.current`, deref references (`authors[]->`, …), and keep image fields
  un-dereferenced (so `urlFor` gets `asset._ref`). See the file for the list-vs-detail set.
- **TypeGen** — `pnpm sanity:types` (`sanity typegen generate`, configured in `sanity.cli.ts`) reads
  `src/lib/sanity/schema.json` + scans `queries.ts` and writes `src/lib/sanity/types.ts` (committed;
  lint/format-ignored). `overloadClientMethods` makes `getSanityClient().fetch(q)` return the query's
  generated `…Result` type — no hand-written result interfaces.
- **`schema.json` is synced from the Studio.** This repo has no Studio. To refresh after a schema
  change: in `../darcstar-sanity-studio` run `pnpm typegen` (which runs `sanity schema extract`), copy
  its `schema.json` here to `src/lib/sanity/schema.json`, then `pnpm sanity:types`.
- **Editing a query? Re-run `pnpm sanity:types` and commit `types.ts`.** `overloadClientMethods` keys
  the result type on the query's literal STRING, so a stale `types.ts` silently degrades
  `fetch(q)` to untyped — `pnpm check` still passes. Nothing in CI guards this yet.
- **The synced `schema.json` can be ahead of what the site consumes.** It's a whole-file copy, so a
  sync pulls in every Studio change since the last one — DAR-70's re-sync also brought
  `person.{fullBio, focusAreas, responsibilities, experience, education}` (DAR-47's schema half).
  Those landed as types only and **stayed unconsumed until DAR-122** built `/people/[slug]` — the
  ticket that closed them (DAR-47) was marked Done on a Studio-only PR, so the fields were authored
  and populated with nothing reading them. A synced field renders nothing until a query selects it
  AND a page draws it.
  Expect unrelated additions in a `types.ts` diff and check they're additive.
  **Diff the two files type-by-type before copying**, so what rides along is known rather than
  discovered: DAR-106's sync turned out to be exactly `+mathBlock`, `+mathInline` and the two
  `blockContent` union members, with no drift at all. DAR-162's was `paper.contribution` (what it
  wanted) plus DAR-123's **`series`** — the `Series` type, `SeriesReference`, and
  `post.{series, seriesPart}` — which are **types only**: no query selects them, nothing renders
  Part N of M, and `/news` still shows a multi-part arc in reverse date order. That is the DAR-47 →
  DAR-122 shape again, recorded here rather than left for a `types.ts` reader to wonder about.
- **The Studio's `seo` object reaches `<Seo>` only through
  [`content-seo.ts`](../src/lib/sanity/content-seo.ts)** (DAR-71). Add new `seo` fields there, not at
  the detail-page call sites — the previous per-page mapping is how `noIndex` came to be fetched and
  then dropped. Its sitemap half is a `seo.noIndex != true` filter in `queries.ts`. → [seo](seo.md)

## Images

**`src/lib/sanity/image.ts`** — `urlFor(field)` (chain `.width().height().url()`) and `ogImageUrl(field)`
(1200×630 social card). Built from `createImageUrlBuilder({ projectId, dataset })` — **no client, no
token** — so URLs are built in the browser too. Asset **binaries** on `cdn.sanity.io` are public by
their hashed URL even though document _reads_ are gated. `src/lib/components/SanityImage.svelte`
wraps `urlFor` into a sized `<img>` (used by cards, covers, avatars, and PT image blocks).

## Portable Text

**`src/lib/components/portable/PortableBody.svelte`** wraps `@portabletext/svelte`'s `<PortableText>`
in a `.prose` container (Tailwind Typography). Default blocks/lists render standard tags; we override
only the schema's custom members: `PortableImage` (image block), `PortableCode` (code block),
`PortableMath` (both LaTeX types), and the `link` mark (`PortableLink`).

### Math is typeset on the server (DAR-106)

The Studio's `mathInline` (atomic node inside a text block) and `mathBlock` (displayed equation) both
store bare LaTeX in a `latex` string. **KaTeX runs in `$lib/server/math.ts`, never in the browser** —
`renderMathIn(body)` walks the body during the `+page.server.ts` load and attaches the rendered HTML
to each math node, and `PortableMath.svelte` only prints it.

Measured, because the ticket sketched the opposite:

|                                          | server-rendered (shipped)                                               | KaTeX in the component                                |
| ---------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| JS on `/news/[slug]`, `/research/[slug]` | **0 B** (grepped out of the build output)                               | 76.3 KB gz                                            |
| per equation, on the wire                | **+661 B gz** — the hydration payload's second copy of the typeset HTML | +0 — the payload already carries the LaTeX either way |

**Both** approaches render the markup during SSR, so that half cancels; what is actually being traded
is one payload copy per equation against the library, once. Crossover: **~115 equations on a single
page** — and that ignores parsing the library. The corpus contains **zero** LaTeX today. DAR-53
treated 39 KB (6.8% of the client bundle) as a saving worth its own ticket; this is twice that, in the
other direction.

The 661 B is measured rather than derived — the real four-equation page was 12,813 B gz, and stripping
just the payload's `html` values from it and re-gzipping gave 10,168 B. A per-equation figure computed
from isolated strings came out ~15% lower, which is why the page was used.

Two things keep it that way rather than merely arranging it that way once:

- The renderer lives in **`$lib/server`**, so Kit refuses to bundle it into the browser.
- **`RenderedBlockContent`** (`src/lib/sanity/block-content.ts`) makes `html` **required** on the math
  members, and that — not `BlockContent` — is what `PortableBody` accepts. A route that renders a body
  it forgot to typeset **fails `pnpm check`**. The type lives outside `$lib/server` only because a
  component cannot import from it. `block-content.spec.ts` pins the gate with a `@ts-expect-error`
  that reports itself as unused the day the type stops discriminating.

Behaviour worth knowing before touching it:

- `displayMode` comes from **where a node sits**, not from its `_type` — top level is displayed,
  inside `children` is inline — so the rendering always matches the markup it is emitted into.
- Malformed LaTeX degrades to its **own visible source** in the theme's error colour (`throwOnError:
false`, plus a `catch` for what that misses — the spec for that found a real throw). Blank LaTeX
  renders nothing at all. Silence is the failure this ticket removed; don't reintroduce it.
- `{@html}` is safe **by construction and by measurement**, and it takes **two** properties, not one.
  KaTeX's `trust: false` refuses the commands that emit markup, and a `<script>` in an editor's string
  comes back escaped inside the MathML annotation — but `html` itself is rendered verbatim, so the
  renderer also has to be **authoritative** over it: it writes `html` last and unconditionally, so a
  document written straight at the Sanity API (which never sees the Studio schema, where no such field
  exists) cannot supply its own. Reordering that spread to `{ html: …, ...node }` reads as a no-op
  cleanup and silently inverts it, which is why all three are asserted in `src/lib/server/math.spec.ts`.
- `onMissingComponent` is at the library default (**warn**). It was `false`, which is how these two
  types could ship in the Studio and render as nothing here with not even a console line. The library
  calls the handler from an `$effect`, which does not run during SSR — so it is a **browser** console
  line, never a Workers Logs one. Guarded by a spec, since the flag has no other observable effect.
- **No render cache, deliberately.** Measured at **0.17 ms per equation** warm, so a ten-equation page
  spends ~1.7 ms of Worker CPU — noise even against the free tier's 10 ms, and well under what a cache
  keyed by every equation ever published would cost in retained memory.
- **`katex.min.css` is imported by the component**, not `layout.css`, so Vite scopes it (8 KB gz) to
  the two detail routes. It drags in **59 font files / 1.2 MB** of deployed assets, ~900 KB of which
  is `woff`/`ttf` no supported browser will ever fetch. Accepted deliberately: trimming to `woff2`
  means hand-copying upstream's 20-face `@font-face` table, which goes stale silently — and it costs a
  visitor nothing, only the bundle.
- `.prose` does **not** fight KaTeX (checked at 390 px and 1280 px against the real worker). The
  displayed equation gets `my-6 overflow-x-auto`, so a too-wide equation scrolls in its own box and the
  page body never does; Typography's own "no top margin after a heading" rule applies to it exactly as
  it would to a paragraph, which is correct — as do its `:first-child` / `:last-child` rules, measured,
  which **beat** the wrapper's `my-6`, so a body opening or closing with an equation keeps the rhythm.
- **No `tabindex` on the scroll wrapper, and that is the measured answer, not an oversight.** The axe
  rule `scrollable-region-focusable` is about a keyboard user being unable to reach a scroller — but
  Chromium and Firefox both make an _overflowing_ container Tab-focusable on their own (measured in
  both, real key events). Adding `tabindex="0"` would be strictly worse: it makes every displayed
  equation a tab stop, including the ones that fit. WebKit is unmeasured (Playwright's build will not
  launch here). `PortableCode`'s `<pre class="overflow-x-auto">` relies on the same behaviour.
- **MathML-only output (`output: 'mathml'`) would drop the stylesheet and all 1.2 MB of fonts**, since
  browsers render MathML natively. Not taken: the ticket specified shipping KaTeX's stylesheet with
  self-hosted fonts, and native MathML typography varies by platform and by whichever math font happens
  to be installed — KaTeX's HTML output is the reason to use KaTeX. Considered, not measured.

## What `siteSettings` actually drives (DAR-73)

The `siteSettings` singleton is a five-tab editing surface in the Studio, and for a long time the
website **never queried it** — every field was editable and inert. That is not a theoretical problem:
a `socialLinks` edit adding LinkedIn and BlueSky was published in `dev`, promoted to `production`, and
rendered nowhere, with no feedback. **One field is now wired; the rest are still inert.**

| Field              | Status   | What drives the site                                                                                                                               |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `socialLinks`      | **live** | the footer's profile row + the Organization `sameAs`                                                                                               |
| `title`            | inert    | `SITE_NAME` (`$lib/site.ts`)                                                                                                                       |
| `tagline`          | inert    | Paraglide `footer_tagline`                                                                                                                         |
| `description`      | inert    | Paraglide `seo_default_description` (localized; the CMS field isn't)                                                                               |
| `contactEmail`     | inert    | `CONTACT_EMAIL` — also the Resend **From:** address of every user-facing mailer (via `EMAIL_FROM`), so CMS control would break domain verification |
| `logo` / `favicon` | inert    | `$lib/assets/favicon.svg`, fingerprint-imported                                                                                                    |
| `titleTemplate`    | inert    | Paraglide `content_doc_title` (`"{title} — DarcStar Technologies"`)                                                                                |
| `defaultOgImage`   | inert    | build-time `scripts/gen-og.mjs` (DAR-69)                                                                                                           |
| `primaryNav`       | inert    | hardcoded nav — and its live value points at `/blog`, `/papers`, `/team`, none of which exist                                                      |

Trimming the inert fields from the Studio schema is DAR-73's **deferred half**; until then, treat this
table as the source of truth for what an edit will actually do.

**The read path.** `siteSettingsQuery` projects down to `socialLinks` alone — deliberately, so that a
field added in the Studio can't silently start shipping to the client, and so the read layer states
what the CMS drives. `$lib/server/site-settings.ts` performs the fetch and
`$lib/social-links.ts` sanitizes it (shared with the Footer's prop default, so there's one definition
of a usable link). URLs pass `isHttpUrl` — the Studio's `rule.uri({scheme})` is a UI affordance an API
write skips, and these become `target="_blank"` hrefs _and_ published `sameAs` identities.

**This is the only Sanity read on the request path of every page** (the footer lives in the root
layout, so it also runs on `/admin`, `/login`, and every form POST). Three properties make that
affordable, and all three are load-bearing:

1. **A 5-minute module-scope TTL cache** — Workers isolates persist, so it's ~one fetch per isolate
   per window. Safe in module scope _only because_ `siteSettings` is public and identical for every
   visitor; the same cache over per-user data would be a cross-request leak.
2. **A 2 s `AbortSignal.timeout`** — without it a hung Sanity stalls every page on the site.
3. **A floor** — any failure (throw, timeout, missing document, all-junk array) resolves to the
   hardcoded `GITHUB_URL`. Failures are negative-cached for 30 s, so an outage stays cosmetic instead
   of buying every request the full timeout.

The floor applies **only to an empty result** and is never merged into a non-empty one — otherwise an
editor could not remove the GitHub link, which is the same lie in the other direction.

## Routes

Each is `+page.server.ts` (`getSanityClient().fetch(typedQuery)`) + `+page.svelte` (CosmicBackdrop +
the shared `PageHero` + one `<Seo>`; chrome copy via Paraglide `m.*`, CMS data as `{expr}`).

- `/news` (list, **paginated**) · `/news/[slug]` (Portable Text body, cover, authors, related papers)
- `/research` (list, **paginated + filtered in GROQ**) · `/research/[slug]` (abstract, status,
  research-topic tags, external links incl. PDF, DarcStar commentary) ·
  `/research/authors.json` (author type-ahead for the filter bar — see DAR-94 below)
- `/people` (team grid) · `/people/[slug]` (authored `fullBio` as Portable Text, focus areas,
  responsibilities, positions, credentials — DAR-122)
- **Resilience:** LIST loads `try/catch` a Sanity outage → empty list + `console.warn` (never a 500);
  DETAIL loads `error(404)` on a missing slug (infra errors propagate as 500).

### One team predicate, three surfaces (DAR-122)

`_type == "person" && kind != "external"` is a single interpolated const (`TEAM_PERSON` in
`queries.ts`) shared by `peopleQuery`, `personBySlugQuery` and `sitemapEntriesQuery`'s people arm.
Unset `kind` counts as team — fail-OPEN, so being hidden needs a positive signal.

They must agree, and the failure isn't cosmetic: a sitemap wider than the route advertises URLs that
404, one narrower links from a page no crawler is told about. `queries.spec.ts` **counts** rather than
contains — within those three queries every `_type == "person"` filter must be the team one, which is
what catches a second arm added with its own rule (measured: `toContain` alone passes that mutation).

Two deliberate asymmetries:

- The **author** queries (`authorSuggestionsQuery`, the `/research` author facet) scope to
  `_type == "person" && defined(slug.current)` — every person, not the team. They search the
  publication record, where external co-authors are most of the vocabulary (123 people for 18 papers).
  Narrowing them would break author filtering; widening the three above would hand every citation-only
  name an indexable page.
- `peopleQuery` alone has **no `defined(slug.current)` filter**. A teammate without a routable slug
  belongs on the team page; they just render without a link. The sitemap needs the filter (an entry
  becomes a URL) and the detail query matches on the slug, so the advertised set stays a subset of
  what the route can serve.

`personBySlugQuery` is separate from `peopleQuery` rather than a widening of it — the grid would
otherwise ship every teammate's positions and summaries on every visit. It deliberately does **not**
project `person.email`: a mailbox on an indexable page is a spam surface with no way back, and
`/contact` exists and is throttled.

### A slug the route can't serve never becomes a URL (DAR-148)

`defined(slug.current)` says a slug EXISTS, not that `[slug]` can serve it. Every path built from one
goes through `new URL` — which **resolves** `../` — so a `../admin` slug turned the team grid's link,
the `Person` `@id` and the sitemap's `<loc>` into the login wall. It needs a hand-crafted API write
(the Studio slugifies typed input), and the destinations are gated and noindex, so what it really
costs is a false machine-readable claim; the sitemap half is a stated invariant `seo.e2e.ts` asserts.

One predicate, `contentPath` ([`src/lib/content-path.ts`](../src/lib/content-path.ts)), at all six
places a slug becomes a URL: the sitemap's three collections, `personId` in `jsonld.ts`, the `/news` ·
`/research` · `/people` card links, and the related-papers list on `/news/[slug]`. Rules worth
keeping:

- **The card survives, the link doesn't** — DAR-122's posture for a slugless teammate, extended to
  every index. The one exception earns it: `/news/[slug]`'s related-papers row is nothing BUT a
  cross-reference, so it drops entirely rather than leaving a dead entry, and the paper keeps its own
  card on `/research`. The test is whether the surface is the document's own listing. An editor who writes a broken slug gets a debuggable page, not a document that
  silently vanishes from the feed. On `/news`, where the whole card is the anchor, it degrades to a
  `<div>` and gives up the hover treatment **and** the "Read article" call to action: a card that
  still says "Read article" and goes nowhere is a worse lie than the link was.
- **The link and the `@id` ask the same question.** They are one claim about one person, so a card
  that links must be a node that identifies, and both consult the same helper.
- **Two checks, and the overlap is the trap.** `../admin` contains a slash, so the segment check
  alone already refuses it — which means a spec whose hostile slugs are all slash-bearing stays green
  with the entire round-trip deleted (measured). `..\admin` is the case that matters: the URL parser
  folds `\` to `/`, so it escapes just as far while containing no slash at all. Both halves, and
  every surface, carry the backslash spelling for that reason.
- **Not `encodeURIComponent`** for the round-trip comparison. It escapes `&`, which would drop
  `a&b<c` — a slug the route serves fine, and the sitemap's only case exercising XML escaping. The
  guard must refuse the unroutable, never the merely unusual.

Residual, and the first draft of this PR is the evidence for how weak it is: nothing fails closed
for a **seventh** call site. The six are pinned by their own specs and the sitemap's mapping is
written once for all collections, so a fourth content type inherits it there — but a new surface that
interpolates a slug itself is caught by review, not by a test (**DAR-154**). That is not hypothetical: the
related-papers row was an EXISTING sixth site, missed by the first sweep of this very change (a `grep`
truncated by `head`), and found only by re-sweeping during review. A DAR-102-style source scan is what
would make it structural.

### /research origin split (DAR-52)

The `paper` type holds two kinds of entry — first-party DarcStar work (`darcstarAuthored: true`)
and notable third-party research we annotate (`commentary`, Portable Text; the list queries expose a
`hasCommentary` boolean via `coalesce(count(commentary) > 0, false)`). Third-party work must never
read as ours, so the rendering rail is:

- The list splits into **"DarcStar research"** and **"Foundational reading"** sections (an empty
  group skips its section); the hero lede covers both kinds instead of claiming everything as ours.
- **`PaperOrigin.svelte`** (beside `PaperStatus` on list cards + detail) chips external entries
  "Third-party", plus a **list-only** "DarcStar commentary" chip when annotated (`hasCommentary`;
  the detail page renders the commentary itself instead). The explicit not-authored-by-DarcStar
  line on both surfaces is **`PaperExternalDisclaimer.svelte`** (a block `<p>` — it can't live in
  the chip row). **Polarity is fail-safe:** `!darcstarAuthored` — an unset/null flag renders as
  external, never as first-party (unit-tested in both components' specs). An external paper's
  fallback meta description also leads with the disclaimer, so social previews carry the origin
  signal too.
- The detail page renders `commentary` through the same `PortableBody` as post bodies (inline
  images resolve identically). The "our take on this work" note above it renders for third-party
  papers only — a first-party paper with commentary gets the section without external framing.

### /research filtering & sorting

`?topic=&contribution=&author=&origin=&sort=&page=` filter (topic **slug**, contribution
`conceptual|formal|empirical|engineering`, author slug **or name**, origin `darcstar|external`), sort
(`date` default · `date-asc` · `title`) and page the index. URL params
are the single source of state: the bar is a **native GET form** (works no-JS; Apply submits),
enhanced on change to a **debounced** `goto` with clean URLs (a collapsed select fires `change` per
arrow keypress in some browsers); the selects carry `value=` as well as option `selected` because
Svelte only toggles the selected ATTRIBUTE, which browsers ignore once the control is user-dirtied
(Clear/Back would desync). A **title sort merges the origin sections** into one A–Z list (cards are
origin-self-sufficient per DAR-52). Topic tags (`PaperTopics`'s `topicHref`) link into `?topic=`,
so a tag is an entry point, not a dead end.

**The filtering itself happens in GROQ** (DAR-94, below). `src/lib/research-filters.ts` keeps only
the URL semantics — parse/build, the param-name contract (`FILTER_PARAM` / `researchTopicHref`),
DAR-52's `isDarcstarAuthored` polarity and the per-page `partitionByOrigin`. Empty/unknown params
still degrade safely; the load reads the URL and re-queries, so a filter change now costs a Sanity
round trip (~235 ms measured) where it used to be free.

**`?contribution=` is validated where `?topic=` is not** (DAR-162), and the asymmetry is the point: a
topic slug is authored content this repo cannot enumerate, so an unknown one has to reach GROQ and
answer nothing (the select renders it as a synthetic option rather than letting it masquerade as
"All"). A contribution kind is a closed enum, listed once as `CONTRIBUTION_KINDS` — which is also the
select's **display order**, the Studio's own field order, a maturity ladder that alphabetising would
scramble. Junk is dropped at the parser. The facet offers only kinds **some paper declares**, matching
the topic/author facets: three of the four are unused today, so all four would be three dead picks.
Keeping `CONTRIBUTION_KINDS` in step with the Studio is manual, but it does **not** fail quiet — which
is worth knowing precisely, because the intuition (that a hand-mirrored list drifts silently, like a
`BLOCK_CONTENT_FIELDS` entry in the Studio) is wrong here. Measured both ways, by editing
`schema.json`, re-running `pnpm sanity:types` and `pnpm check`:

| Studio change      | result                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a kind **added**   | `pnpm check` **fails, 2 errors** — `Paper['contribution']` widens past `ContributionKind`, so neither `<PaperContribution>` mount point accepts `paper.contribution` |
| a kind **removed** | `pnpm check` fails, 1 error — but only in a **spec fixture** that happens to name the value; no production code narrows                                              |

So the case that matters — a kind added in the Studio that the control would never offer — is caught
structurally, by the mount points rather than by the list. The removal case is incidental, holding only
because `[slug]/page.svelte.spec.ts` enumerates all four kinds. `PaperContribution`'s
`Record<ContributionKind, …>` label map catches the follow-up step: adding the kind to
`CONTRIBUTION_KINDS` and forgetting its label.

### Pagination + server-side filtering (DAR-94)

Both indexes serve **one page** (`PAGE_SIZE = 20`, `$lib/pagination.ts`), so HTML per request is
flat in the corpus instead of growing with it. `/research` was 161 KB of HTML and a 44.6 KB Sanity
payload for 18 papers; the same page is now **125 KB** and the payload **25.8 KB**, and neither
moves as papers are added.

Three things had to change together, because a slice alone breaks the page:

- **Facets moved to their own source.** They used to derive from the fetched papers, which stops
  working the moment that set is one page — a Topic select built from 20 papers offers 20 papers'
  worth of topics. `papersPage*Query` now projects the taxonomy's own in-use vocabulary
  (`count(*[… references(^._id)]) > 0`) alongside the page. This makes the DAR-56 topic guide
  **more** correct, not less: it describes the whole index rather than what is in view.
- **Three query literals, one projection.** GROQ's `order()` can't be parameterised, so the sort
  picks between `papersPageByDateQuery` / `…ByDateAscQuery` / `…ByTitleQuery`. Everything that must
  not vary is a shared `const`, and `queries.spec.ts` strips the order clause and asserts the three
  are **byte-identical** — a filter-predicate drift is invisible to the types, since all three
  `…Result` types stay structurally the same.
- **Origin became the major sort key** on the date sorts. The DAR-52 section split was a render-time
  partition of a date-sorted list; under pagination a page could straddle the boundary and the
  headings would describe a subset of what sits under them. `select(darcstarAuthored == true => 0,
  1. asc` reproduces today's rendering exactly while keeping each page's sections contiguous.

Payload trims that came with it: the card `abstract` is cut to **50 words** (47% of the old payload;
the card `line-clamp-3`s it anyway — measured in a real browser at 390/768/1440 px, every truncated
abstract still overflows the clamp, and a `…` marks the cut for the case a short-worded abstract
doesn't), topic `description` left the list projection (it was 15 copies of one string feeding a
`title` tooltip), and `post.featured` went with `postsQuery` (authored, never rendered).

**Rules worth keeping:**

- **`?page=` is deliberately not in `FILTER_PARAM`.** That omission IS the "changing a filter
  returns you to page 1" rule: `buildFilterQuery` only emits keys it finds there, and the no-JS path
  is a native GET form, which replaces the whole query string. Pinned in `research-filters.spec.ts`.
- **A page past the end 302s to the last page**, rather than rendering an empty index that reads as
  "no results" instead of "no such page". Page 1 is always in range, so the normal path never
  redirects.
- **Query views canonicalise to the bare path for free** — `Seo.svelte` derives both `canonical` and
  `og:url` from `page.url.pathname`, which excludes the query string. That is what makes leaving
  `?page=`/filter views out of the sitemap safe (every paper has its own entry, so discovery never
  depended on the list). It was already true before this ticket, which is why it now has an e2e:
  nothing else would notice it breaking.
- **Branch on the TOTALS, not on `data.papers.length`.** That is one page now, so an empty index and
  a filter matching nothing look identical from the component — and gating the filter bar on the
  page's rows would take the bar away with the results, stranding the visitor on a "no matches"
  message with no control left to undo it.
- **Title collation stepped down here and was restored by DAR-95** — see _Sort keys_ below. GROQ
  orders strings by code point, so `lower(title)` bought back case-insensitivity but not the
  accent-insensitivity `localeCompare(…, {sensitivity: 'base'})` had.
- **`defined(abstract)` as a FILTER disagrees with the same expression in a projection.** Measured on
  production, reproducibly and across two API versions: `count(*[_type == "paper" &&
defined(abstract)])` answers **6** while all **18** papers return `defined(abstract): true` from a
  projection. The truncation therefore doesn't gate on it.

  Checked the rest of the fields rather than generalising, because the alarming reading would be
  that every `defined()` guard on the site is unreliable: `slug.current` (papers **and** posts —
  the guard every list query depends on), `title`, `venue` and `darcstarAuthored` all **agree**
  filter-vs-projection. So nothing shipped is affected; the oddity is confined to `abstract`, the
  one long-text field. Treat `defined()` on a large text field as suspect, not `defined()` at large.

  **DAR-95 found the cause, and it is documented rather than a bug**: Sanity's GROQ functions
  reference states that `defined()` "will not provide the expected result" for string fields longer
  than 1024 characters, and recommends `match` instead. Confirmed on the data — the flagged papers'
  abstracts measure 1186, 1452 and 1664 characters, all over the line, while every abstract under it
  behaves. So the rule now has a threshold rather than a shrug: **never `defined()` a field that can
  exceed 1024 characters.** (The Studio's own `paper-no-abstract` content-lint check still does, and
  falsely flags 12 of 18 papers — filed separately, it is not this repo's file.)

- **A facet TTL cache was considered and rejected.** The vocabulary rides the page's existing round
  trip, so a cache would buy nothing and add a staleness window plus a second failure mode. It
  becomes right only if facets ever move to a separate request.
- **Pager and filter links preload on hover, and that is deliberately left alone.** `app.html` sets
  `data-sveltekit-preload-data="hover"` body-wide, so hovering one runs the load — verified: a hover
  alone fires `GET /research/__data.json?topic=…`, i.e. a real Sanity round trip. Here that is a pure
  latency win, because **these loads have no side effects**. That is the whole distinction from
  DAR-66, where `/waitlist` had to opt out with `preload-data="tap"` because its load RECORDED a
  funnel view and a mouse sweep would have invented traffic. If anything (analytics, a write, a
  counter) is ever added to the `/research` or `/news` load, it inherits that trap — opt the links
  out in the same change, or hovers will fire it.

#### The author facet is a text input, not a select

The one facet pagination does **not** make flat. Measured: 123 distinct authors across 18 papers
against 134 author slots — papers barely share co-authors, so the vocabulary grows ~7 per paper and
never plateaus (~2,000 at 300 papers ≈ 96 KB of JSON, rendered twice per request, several times the
page it sits above).

So the control is an `<input list="research-author-options">`: the `<datalist>` is **seeded with
team authors** (`kind != "external"` — bounded, and a native datalist offers them with JS off), and
at **3+ characters** it is replaced by server matches from `GET /research/authors.json?q=`, team
first. ~0.3 KB per request at any corpus size.

- `?author=` accepts a **slug or a typed name** (`$author in authors[]->slug.current ||
authors[]->name match ($author + "*")`), so existing shareable links keep working while a visitor
  can just type. The load resolves an exact **slug** back to a display name for the box — never via
  the `match` form, or `?author=da` would label the control with one person while the results
  legitimately held several.
- **The 3-character floor is enforced server-side**, not just in the browser. Measured, `match ("" +
"*")` and `match ("*" + "*")` each return ALL 123 people — so without it the endpoint hands out
  the exact vocabulary the input exists to keep off the page. `authorSearchTerm` owns the floor and
  the wildcard strip so the two callers can't disagree.
- Named `authors.json` (mirroring `sitemap.xml/+server.ts`): a dotted segment can't shadow
  `/research/[slug]`. `reroute` de-localizes, so one path serves every locale, and `connect-src
'self'` already covers the lookup — no CSP change.

### Sort keys — accent-aware ordering in GROQ (DAR-95)

DAR-94 moved ordering server-side, and GROQ has no locale collation: it orders strings by code
point. That is not a gap you can close in the query. The `string::` namespace offers only
`startsWith` and `split` — no replace, no normalize — `order()` takes no collation argument, and
custom GROQ functions are projection-shaped (`$param{...}`), so they cannot compute a string. The
normalized value has to be **stored**.

The **Studio's `pnpm promote`** derives it (`scripts/lib/sort-key.ts`, `SORT_KEYS` in
`scripts/promote.ts`) into two hidden, read-only fields — `paper.titleSortKey`, `person.nameSortKey`
— and this repo orders by `coalesce(<key>, lower(<source>))`.

- **The reachable defect was people, not papers.** No paper title in the corpus carries a diacritic,
  but `Łukasz Kaiser` sorted **last of 123 authors**, after every Z. So `ORDER_PERSON_NAME` covers
  all three by-name orderings (the `teamAuthors` facet seed, `authorSuggestionsQuery`, `peopleQuery`)
  through **one** const — two of which weren't even `lower()`ed before. It matters most on the
  suggestion endpoint, which is **capped at 12**: there a name that mis-sorts to the end doesn't just
  look odd, it falls off the response.
- **`Ł` is why `NFD` alone isn't enough.** NFD decomposes `é` into `e` + a combining mark that
  `\p{Diacritic}` then strips, but stroke and ligature letters carry no decomposition at all — hence
  an explicit folding map (`ł→l · ø→o · đ→d · ð→d · þ→th · ß→ss · æ→ae · œ→oe`). Eight of its
  eleven entries reproduce base-sensitivity collation exactly (measured: `localeCompare(c, fold,
{sensitivity:'base'}) === 0`); `ı`, `þ` and `ŧ` deliberately go **further** than ICU, which treats
  them as primary-distinct — a judgement about who reads this index, pinned by the self-test so
  "match ICU exactly" stays a decision rather than a silent regression. Either way it is an
  approximation for **Latin** scripts, not ICU: non-Latin still sorts by code point after ASCII,
  exactly as it does today.
- **Keep the `coalesce` fallback.** A document with no key sorts exactly as it did before — measured,
  not assumed: against the corpus as it stands (no keys yet), `coalesce(titleSortKey, lower(title))`
  returns the 18 titles **byte-identically** to `lower(title)`. That is what lets the two repos ship
  in either order, and what makes an un-promoted document degrade rather than jump to the front under
  a null. `queries.spec.ts` pins it by **counting**: every mention of a key must sit inside its
  coalesce **or a `match` arm** (DAR-104 below), because `order(titleSortKey asc)` would type-check
  and break every un-keyed row. The right-hand side of that count enumerates the permitted uses, so
  a key turning up somewhere new is a decision rather than an accident.
- **Derived at promote, so it cannot go stale.** Promote is the chokepoint every published document
  crosses on its way to the dataset this site reads, and it recomputes the key from the document's
  own text rather than copying one through. A stale key would be **worse than none** — it sorts a
  renamed document under its old name, where `lower(title)` is at least always self-consistent.
  Consequences, all deliberate: `dev` never carries a key (it is a publication artifact); a document
  written straight to `production` gets none and falls back; a `VITE_SANITY_DATASET=dev` build falls
  back too. `pnpm check:content` warns on drift and self-checks the normalizer.
- **`topic.title` is deliberately left un-keyed** — a bounded ten-term vocabulary, all ASCII, in a
  `<select>` that is scanned rather than searched. Asserted in the spec so "skipped" stays
  distinguishable from "forgotten".

### The same key answers "did they mean this person?" (DAR-104)

`match` compares code points too, so author **search** was accent-sensitive long after the ordering
was fixed. Measured against production, every accented author in the corpus was unreachable by the
spelling an English keyboard produces:

| `?author=`                      | before        | after                    |
| ------------------------------- | ------------- | ------------------------ |
| `luk` · `lukasz`                | 0             | 1 — `Łukasz Kaiser`      |
| `re`                            | 0             | 1 — `Christopher Ré`     |
| `konighofer`                    | 0             | 1 — `Bettina Könighofer` |
| `dao` · `tri-dao` · `da` · `gu` | 4 · 4 · 8 · 2 | unchanged                |

So `PAPER_MATCH` and `authorSuggestionsQuery` each gained a `nameSortKey match (… + "*")` arm beside
the `name` one. Four things worth keeping:

- **The filter half is the one that was verified end-to-end**, and the type-ahead half was not: the
  arm makes the _endpoint_ answer `?q=luk` with `Łukasz Kaiser`, but whether the visitor SEES it is
  a separate question, because the control is a native `<datalist>` that applies its own matching to
  the options it is handed. That was recorded as **open** rather than claimed, and **DAR-105 settled
  it: the browser was hiding the row** — see [the datalist filters what the server
  found](#the-datalist-filters-what-the-server-found-dar-105) below. The bound that made it a
  separate ticket rather than a bug in this one still holds: the datalist is progressive enhancement
  over a plain text field and `PAPER_MATCH` carries the same arm, so typing `luk` and submitting
  returned the paper the whole time.
- **The arm is additive, never a substitution.** A key is a `production` artifact, so on `dev` — or
  on any document written past promote — the folded arm simply doesn't fire and the predicate
  degrades to exactly the pre-DAR-104 behaviour. Measured against `dev`, where no document has a
  key: no error, same results. Same fail-safe polarity as the origin flag two sections up.
- **The two call sites cannot share one expression**, and that is DAR-94's constraint, not an
  oversight: `defineQuery` must receive a const-interpolated template, so a shared builder function
  would widen the query's type to `string`, break `overloadClientMethods`, and make `client.fetch()`
  return `any`. The arms are therefore written twice and the spec **counts** them: each plain match
  must be paired with a folded one, so widening one call site and forgetting the other fails rather
  than quietly desyncing the type-ahead from the filter it feeds.
- **The suggestion arms must stay parenthesised.** Without the group, `&&` binds tighter than `||`
  and the published-papers filter would apply to only the second arm — a precedence bug no type can
  see, which the counting pin does **not** catch (the counts stay equal). It has its own assertion,
  mutation-verified.

It does **not** revive DAR-100's retired `?author=ukasz-kaiser`: the folded key is `lukasz kaiser`,
and `ukasz` is not a token prefix of it. Measured, still 0.

### The datalist filters what the server found (DAR-105)

DAR-104's endpoint fix was correct and invisible. `/research`'s author control is a native
`<datalist>`, which applies its **own** matching to the options it is handed, and that matching is
unspecified. Measured in headed Chromium and Firefox — a positive control (ASCII option, exact
prefix) and a **negative** control (a term matching nothing) both holding in each — it is a
case-insensitive **substring test that compares code points**. Typing `luk` against
`value="Łukasz Kaiser"` produced **no popup at all**, in both engines.

The measurement is the interesting part, because two instruments failed before one worked:

| instrument                             | result                                                        |
| -------------------------------------- | ------------------------------------------------------------- |
| browser-automation extension (DAR-104) | control failed — synthetic keys do not drive the native popup |
| Playwright real key events + ArrowDown | control failed in Chromium, **passed in Firefox**             |
| **X root-window capture** of the popup | **control passed in both** — the popup is a separate X window |

A page screenshot never contains the popup, which is what made this look unmeasurable; the root
window does. Two environment traps on the way: Playwright's Chromium runs as a native **Wayland**
client here, so it has no X window at all (`--ozone-platform=x11`), and `import -window root` cannot
read an Xwayland root either — the probe has to run under `xvfb-run`, a real X server.

**The two engines are opposites, and that decides the fix:**

|          | Chromium                           | Firefox                                     |
| -------- | ---------------------------------- | ------------------------------------------- |
| matches  | `value` **or** `label`             | **`label` only** when present, else `value` |
| displays | `value` bold, `label` grey beneath | `label` if present, else `value`            |

So the obvious repair — ASCII slug in `value`, real name in `label` — works in Chromium and renders
**nothing** in Firefox. That was the plan of record until the captures came back. The label has to
be the accent-blind target instead, and it has to carry **both** spellings
(`Łukasz Kaiser (lukasz kaiser)`), or making `luk` work would cost `Łuk` the suggestion in Firefox —
trading one unreachable spelling for another rather than fixing anything.

What ships (`authorOptionLabel` in `$lib/research-filters.ts`, rendered by
`AuthorSuggestions.svelte`):

- **`value` is untouched**, so every URL the control can produce is byte-identical to before. Only a
  suggestion was ever broken, never a filter.
- The label is emitted **only for a non-ASCII name** — 120 of the 123 authors carry no attribute at
  all. Emitting one for them would be a pure regression, not a no-op: Firefox would start rendering
  `Tri Dao` as its lowercased sort key.
- The folded string is **read from the document** (`nameSortKey`, projected as `key` by both option
  sources). `NFD` + strip `\p{Diacritic}` is the reflex and it fixes `Ré` and `Könighofer` while
  leaving the headline `Ł` exactly as broken — DAR-95's lesson — so a second copy of the Studio's
  folding map would be both wrong and unguarded. Absent key → no label → pre-DAR-105 behaviour,
  the same fail-safe polarity as the folded `match` arm (verified against `dev`, which carries none).
- **The emit condition is a containment test, not an accent test**, and that is what makes the
  guarantee structural: a label is emitted exactly when the key offers a spelling the name does not
  already contain. So the suggestion list can never offer **less** than the filter finds — the
  server matches a token **prefix** of `name` or `nameSortKey`, the browser matches a **substring**
  of the label if there is one and of the name if there is not, and either the label carries both
  strings whole or the name already covers both. Phrasing it that way also picks up a case an accent
  test would miss (a name whose whitespace `sortKey` collapses, `Tri  Dao` → `tri dao`, is reachable
  by the typed spelling) and skips one it would wrongly catch (a CJK name folds to itself, so a
  label would be noise). Pinned by a spec that enumerates every token prefix of both fields.
- **Display cost, Firefox only — accepted, not incidental.** Firefox renders the label _in place of_
  the value and sizes the popup row to the input, and that input is **~151px at every viewport**
  (measured 390 / 768 / 1180 / 1280 / 1440 / 1920 — it is a `1fr` column in a width-capped filter
  bar, so it never grows). About 18 characters fit, which makes this the normal Firefox rendering
  rather than a narrow-screen edge case:

  | author               | Firefox row            |                              |
  | -------------------- | ---------------------- | ---------------------------- |
  | `Christopher Ré`     | `Christopher Ré (chr…` | name in full, hint clipped   |
  | `Łukasz Kaiser`      | `Łukasz Kaiser (luk…`  | name in full, hint clipped   |
  | `Bettina Könighofer` | `Bettina Könighofe..`  | **name one character short** |

  That last row is a real cost, not a nominal one: measured, the un-labelled value renders in full at
  that width. It is why the name comes first — the hint is the first thing to go. Accepted anyway,
  because the alternatives are worse: a folded-only label is short and never clips but renders the
  person's name lowercase and unaccented _and_ stops Firefox suggesting the accented spelling, and
  widening the Author column still leaves `Bettina Könighofer (bettina konighofer)` (~265px) clipped
  at any plausible size. Chromium is unaffected (value bold, label grey beneath, nothing clipped).

Honest residual: **WebKit is unmeasured** — Playwright's build cannot launch here (missing host
dependencies) — but the change is safe there by construction, since it only adds a second string the
engine may match on and leaves `value` alone. Whether Safari's popup then displays `value` or
`label` is cosmetic, and confined to those three authors.

### Paper meta-rail charge mapping

The chips/pills around a paper color-code the brand triad ([styling — color-charge triad](styling.md#the-color-charge-triad--one-source-of-truth)) by MEANING, so a new chip must pick the right charge — don't grab a color ad hoc:

| Charge | Meaning on the paper rail                | Component / tone                                            |
| ------ | ---------------------------------------- | ----------------------------------------------------------- |
| **R**  | research **topic** (what it's about)     | `PaperTopics` — `border-tertiary-500/40 text-tertiary-400`  |
| **G**  | **DarcStar commentary** chip (list only) | `PaperOrigin` — `border-secondary-500/40`                   |
| **B**  | **actionable / published**               | `PaperLinks` (filled = link) · `PaperStatus` published tone |

Neutral (`border-hairline`) = non-semantic chrome (statuses, **contribution kinds**, "Third-party",
categories). All pill geometry comes from `PaperStatus`'s exported `pillClass`.

`PaperContribution` (DAR-162) is neutral on purpose and it is the case that most tempts a charge:
`paper.contribution` is the field that exists so a conceptual framework stops presenting like a
proven result, so a colour to make it _louder_ is the obvious move. It is still wrong — the pill is a
**descriptor**, not a verdict, and the four kinds are peers (an engineering report is not a lesser
thing than a formal result). Colouring one of them would rank them. Where emphasis genuinely belongs
is the `conceptual` **caveat card** above the abstract on `/research/[slug]`, which is prose and a
link rather than a chip. It also exports `contributionLabel` for `/research`'s Contribution select,
the `pillClass` convention again: the select needs those four strings, and a second copy of the
mapping there would be free to drift from the pill's. The B charge carries two meanings, so
the **rest fill** disambiguates: `PaperLinks` pills are filled (`bg-primary-500/10`) = clickable;
the published status pill is outline-only = badge. Topic `description` still renders as a `title`
tooltip on **`/research/[slug]`**, where there is no topic guide — but that is progressive
enhancement **only**, never the rendering. It is gone from the **list** cards: DAR-94 dropped
`description` from the list projection (15 copies of one string per page), and the visible rendering
there is `TopicGuide` (below).

### The venue · date slot is a component, because Svelte eats the separator (DAR-153)

`PaperVenueDate` renders the rail's third slot. It exists as a component because `/research` and
`/research/[slug]` carried **byte-identical** copies of the markup and both shipped
`Zenodo·February 4, 2026` — on all 18 cards and every paper page — for the life of the index:

```svelte
{#if paper.venue}{paper.venue}{/if}{#if paper.venue && paper.publishedDate}
	·
{/if}{#if paper.publishedDate}{formatDate(paper.publishedDate, getLocale())}{/if}
```

The `·` sits alone on its own line inside the `{#if}`, and **Svelte trims whitespace at a block
boundary** — here on both sides at once, so nothing separated the two values. Five things worth
keeping:

1. **`&nbsp;` on BOTH sides**, which is where this differs from `/people/[slug]` and `/news/[slug]`:
   those need only a leading one, because the space _after_ their separator is interior to its block
   and survives. Here it would be the block's trailing whitespace and is trimmed, so the one-sided
   fix leaves `Zenodo ·February 4, 2026` — half the bug, and the half that looks deliberate
   (mutation-measured, and it was the fix the ticket prescribed). Entities are not ASCII whitespace,
   so re-wrapping the block over three lines cannot bring the defect back — also measured, by
   re-applying exactly the formatting that created it and watching the specs stay green.
2. **Extracted, not patched twice.** One `Paper*` component beside the rest of the meta family means
   one spec instead of two and no third surface to get wrong.
3. **The condition and the content must read the same value.** Writing the spec surfaced a second,
   inherited defect: the separator was gated on the raw `publishedDate` while the text came from
   `formatDate`, which returns `''` for a null/empty/unparseable value — so a write bypassing the
   Studio's date widget (DAR-70's rule: Studio validation is a UI affordance an API write skips)
   rendered a dangling `Zenodo ·`. It now gates on the formatted string, so a paper whose only field
   is an unrenderable date produces **no element at all** — not an empty `<span>`, which would still
   be a flex item claiming a `gap-3` (DAR-56's empty-wrapper trap).
4. **The scope table in the ticket was wrong, and how it was built is the lesson.** It listed four
   surfaces and declared `/research` "the last one", because it was assembled by checking the
   surfaces I thought of. `/research/[slug]` was equally broken and equally visible. Enumerating the
   **pattern in source** (`grep -rn '·' src --include=*.svelte`) found it in seconds; enumerating
   renderings from memory never would.
5. **Nothing on the site catches this by rendering**, which is why each surface is pinned by a
   `client`-project spec: the same trap in `/news/[slug]`'s related-papers row survived indefinitely
   because no published post has related papers. The assertion normalises whitespace before
   comparing — `\s` matches U+00A0, so it states "there IS separation" rather than pinning the
   mechanism; a plain space would still go red the moment the block is re-wrapped.
6. **One change here is not whitespace, and it is worth naming rather than slipping in**: the `·` is
   now `aria-hidden`, which neither `/research` page had. The dot is decoration, so a screen reader
   should hear "Zenodo February 4, 2026" rather than a punctuation name. The site's **seven** other
   separators (Footer ×2, `/news`, `/news/[slug]`'s byline and its related-papers row,
   `/people/[slug]` ×2) now all agree — the related-papers row was the last holdout and came along in
   the same change. It is the only separator **inside a link**, so it is the only one where the
   attribute changes an accessible **name** (`"The Intelligence Ratchet arXiv"`) rather than text
   beside it; its venue stays in the name, because a venue is content and only the glyph is
   decoration. That one therefore needs a **name** assertion rather than an attribute one — removing
   the attribute must fail a `getByRole({ name })` lookup, mutation-verified, since role-name matching
   normalises whitespace and could plausibly have swallowed the dot on its own. Two things this cost getting right: a **rendered-text** diff
   cannot see an added element at all (the "byte-identical once whitespace is stripped" check runs on
   tag-stripped text, so "whitespace is the only change" was true of the text and false of the
   markup), and the first write-up of this rule said "the three other separators all do", which was
   wrong in both the count and the "all" — the consistency argument is the whole justification for
   the attribute, so it is the one claim here that had to be counted rather than recalled.

### Topic descriptions are rendered, not tooltipped (DAR-56)

The Studio's `topic.description` ("shown alongside the papers tagged with it") reached nothing but
a `title` tooltip on the `PaperTopics` tags, which needs a pointer: invisible on touch, unreachable
by keyboard, inconsistently announced by screen readers. `TopicGuide.svelte` renders it for real on
/research, in two surfaces because they answer different questions:

- a **collapsed `<details>` legend** ("What these topics mean") — a `<dl>` of every in-use
  described topic, each title linking to its `?topic=` view. Costs one line when unopened;
- the **active-topic block** — when `?topic=` is set, that topic's title + description render
  **plainly visible, outside the disclosure**. This is what closes the loop for a touch user: tap a
  tag on a card → land on the filtered view → read what it means, with nothing to open. A
  disclosure here would be the tooltip's problem in a new costume.

Rules: both derive from the **taxonomy's own in-use vocabulary** (`data.topics`, projected by
`papersPage*Query` — DAR-94), never from the papers in view, or filtering to one topic (or simply
being on page 3) would shrink the legend to whatever is on screen. Originally that meant "the whole
fetched index"; pagination made the distinction load-bearing rather than merely tidy. **Undescribed
topics are omitted** (a bare title just echoes the facet select), and when none has a description
the component renders **nothing at all**, not an empty wrapper (the page spaces children with
`space-y-8`, i.e. `> * + *`). The Topic select projects from the same list via `topicOptions`, so
"which topics does this index have" cannot answer differently in two places.

Guarded by `TopicGuide.svelte.spec.ts`, which only means anything because the `client` vitest
project runs **real chromium**: it distinguishes _visible_ from _in the DOM_, which is the entire
bug. It proves the closed `<details>` genuinely hides its body (both directions — hidden closed,
shown opened) before relying on that anywhere else. Deliberately **no e2e**: CI runs Playwright
without `SANITY_VIEWER_TOKEN`, so /research is empty there and the guide is correctly absent.

## Configuring the dataset / project

`projectId`, `dataset`, and `apiVersion` come from `VITE_SANITY_*` env vars, defaulting to
`8v6ikhvv` / `production` / `2026-06-24` (`src/lib/sanity/config.ts`; types in `src/vite-env.d.ts`).

- **Why build-time, not runtime:** an image URL embeds the dataset
  (`cdn.sanity.io/images/<projectId>/<dataset>/…`) and those URLs are built **on the client** during
  hydration, so the value must be identical on server and client. A runtime `readEnv`/`platform.env`
  read is server-only (invisible to the browser) and would desync the image URLs. Vite inlines
  `import.meta.env.VITE_*` into **both** bundles at build, guaranteeing one consistent value.
  (Verified: a build with `VITE_SANITY_DATASET=x` bakes `x` into both the server and client output.)
- **To change it:** set `VITE_SANITY_DATASET` (and/or `VITE_SANITY_PROJECT_ID`,
  `VITE_SANITY_API_VERSION`) in that build's env — local `.env` for `pnpm dev`/`pnpm build`, or the
  build environment for a deploy. Takes effect on the **next build** (it's a build-time value, not a
  runtime toggle). These are **public**, so they are NOT `wrangler secret`s — set them where the build
  runs, not with `wrangler secret put`.
- **Per-environment split** (e.g. preview → `dev`, prod → `production`): prod and preview are separate
  builds, so set `VITE_SANITY_DATASET=dev` in the **preview** Worker's build env and leave prod on the
  default. (The `dev` dataset is currently private/empty — this is the mechanism, not a live config.)

## Setup / runbook

1. **Create the read token** — Sanity Manage → project `8v6ikhvv` → API → Tokens → a **Viewer**
   (read) token.
2. **Local** — add `SANITY_VIEWER_TOKEN="…"` to `.env` (+ it's in `.env.example`, which is where
   `pnpm gen` reads the name from so `readEnv` is typed — see [deployment](deployment.md)).
3. **Prod** — `wrangler secret put SANITY_VIEWER_TOKEN` **and** `wrangler secret put
SANITY_VIEWER_TOKEN --env preview` (the preview Worker). No `wrangler.jsonc` change (it's a secret,
   not a var).

## Deferred

Draft/preview (Presentation tool, stega, `useCdn:false` + `previewDrafts`) · a CI `schema.json` drift
gate · category filter pages · trimming the inert `siteSettings` fields from the Studio
schema (DAR-73's deferred half — see the table above; wiring them is deliberately **not** planned) ·
`es` translation of the new chrome (untranslated today — `es.json` carries translated keys only and
everything else falls back to `en`; `noindex`).
