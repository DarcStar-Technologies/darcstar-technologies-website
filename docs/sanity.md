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
  Those land as types only; `peopleQuery` doesn't select them, so nothing renders until that ticket
  wires them. Expect unrelated additions in a `types.ts` diff and check they're additive.
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
only the schema's custom members: `PortableImage` (image block), `PortableCode` (code block), and the
`link` mark (`PortableLink`).

## What `siteSettings` actually drives (DAR-73)

The `siteSettings` singleton is a five-tab editing surface in the Studio, and for a long time the
website **never queried it** — every field was editable and inert. That is not a theoretical problem:
a `socialLinks` edit adding LinkedIn and BlueSky was published in `dev`, promoted to `production`, and
rendered nowhere, with no feedback. **One field is now wired; the rest are still inert.**

| Field              | Status   | What drives the site                                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `socialLinks`      | **live** | the footer's profile row + the Organization `sameAs`                                                                |
| `title`            | inert    | `SITE_NAME` (`$lib/site.ts`)                                                                                        |
| `tagline`          | inert    | Paraglide `footer_tagline`                                                                                          |
| `description`      | inert    | Paraglide `seo_default_description` (localized; the CMS field isn't)                                                |
| `contactEmail`     | inert    | `CONTACT_EMAIL` — also the Resend **From:** address on five mailers, so CMS control would break domain verification |
| `logo` / `favicon` | inert    | `$lib/assets/favicon.svg`, fingerprint-imported                                                                     |
| `titleTemplate`    | inert    | Paraglide `content_doc_title` (`"{title} — DarcStar Technologies"`)                                                 |
| `defaultOgImage`   | inert    | build-time `scripts/gen-og.mjs` (DAR-69)                                                                            |
| `primaryNav`       | inert    | hardcoded nav — and its live value points at `/blog`, `/papers`, `/team`, none of which exist                       |

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
- `/people` (team grid — `person` where `kind != "external"`; unset `kind` counts as team)
- **Resilience:** LIST loads `try/catch` a Sanity outage → empty list + `console.warn` (never a 500);
  DETAIL loads `error(404)` on a missing slug (infra errors propagate as 500).

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

`?topic=&author=&origin=&sort=&page=` filter (topic **slug**, author slug **or name**, origin
`darcstar|external`), sort (`date` default · `date-asc` · `title`) and page the index. URL params
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
- **Title collation changed, deliberately.** GROQ orders strings by code point, so `lower(title)`
  buys back case-insensitivity but not the accent-insensitivity `localeCompare(…, {sensitivity:
'base'})` had. Measured: zero visible change on today's corpus. Fixing it properly means a
  normalized `titleSortKey` in the Studio.
- **`defined(x)` as a FILTER can disagree with the same expression in a projection.** Measured on
  production: `count(*[_type == "paper" && defined(abstract)])` answers **6** while all **18** papers
  return an abstract from a projection. The truncation therefore doesn't gate on it.
- **A facet TTL cache was considered and rejected.** The vocabulary rides the page's existing round
  trip, so a cache would buy nothing and add a staleness window plus a second failure mode. It
  becomes right only if facets ever move to a separate request.

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

### Paper meta-rail charge mapping

The chips/pills around a paper color-code the brand triad ([styling — color-charge triad](styling.md#the-color-charge-triad--one-source-of-truth)) by MEANING, so a new chip must pick the right charge — don't grab a color ad hoc:

| Charge | Meaning on the paper rail                | Component / tone                                            |
| ------ | ---------------------------------------- | ----------------------------------------------------------- |
| **R**  | research **topic** (what it's about)     | `PaperTopics` — `border-tertiary-500/40 text-tertiary-400`  |
| **G**  | **DarcStar commentary** chip (list only) | `PaperOrigin` — `border-secondary-500/40`                   |
| **B**  | **actionable / published**               | `PaperLinks` (filled = link) · `PaperStatus` published tone |

Neutral (`border-hairline`) = non-semantic chrome (statuses, "Third-party", categories). All pill
geometry comes from `PaperStatus`'s exported `pillClass`. The B charge carries two meanings, so
the **rest fill** disambiguates: `PaperLinks` pills are filled (`bg-primary-500/10`) = clickable;
the published status pill is outline-only = badge. Topic `description` still renders as a `title`
tooltip on **`/research/[slug]`**, where there is no topic guide — but that is progressive
enhancement **only**, never the rendering. It is gone from the **list** cards: DAR-94 dropped
`description` from the list projection (15 copies of one string per page), and the visible rendering
there is `TopicGuide` (below).

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
gate · a normalized `titleSortKey` in the Studio (GROQ has no locale collation — see DAR-94 above) ·
category filter pages · trimming the inert `siteSettings` fields from the Studio
schema (DAR-73's deferred half — see the table above; wiring them is deliberately **not** planned) ·
`es` translation of the new chrome (untranslated today — `es.json` carries translated keys only and
everything else falls back to `en`; `noindex`).
