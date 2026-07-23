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

## Routes

Each is `+page.server.ts` (`getSanityClient().fetch(typedQuery)`) + `+page.svelte` (CosmicBackdrop +
the shared `PageHero` + one `<Seo>`; chrome copy via Paraglide `m.*`, CMS data as `{expr}`).

- `/news` (list) · `/news/[slug]` (Portable Text body, cover, authors, related papers)
- `/research` (list) · `/research/[slug]` (abstract, status, external links incl. PDF)
- `/people` (team grid — `person` where `kind != "external"`; unset `kind` counts as team)
- **Resilience:** LIST loads `try/catch` a Sanity outage → empty list + `console.warn` (never a 500);
  DETAIL loads `error(404)` on a missing slug (infra errors propagate as 500).

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
2. **Local** — add `SANITY_VIEWER_TOKEN="…"` to `.env` (+ it's in `.env.example`), then `pnpm gen`
   (`wrangler types` picks up the name so `readEnv` is typed).
3. **Prod** — `wrangler secret put SANITY_VIEWER_TOKEN` **and** `wrangler secret put
SANITY_VIEWER_TOKEN --env preview` (the preview Worker). No `wrangler.jsonc` change (it's a secret,
   not a var).

## Deferred

Draft/preview (Presentation tool, stega, `useCdn:false` + `previewDrafts`) · a CI `schema.json` drift
gate · pagination · category filter pages · `siteSettings`-driven nav/branding · `es` translation of
the new chrome (mirrors `en`, `noindex`).
