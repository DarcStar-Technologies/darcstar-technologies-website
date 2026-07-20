# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

**This file is an index, not a manual.** Keep it lean: each subsystem and durable lesson lives in a short doc under `docs/`, linked below. When you add a subsystem or learn something that isn't obvious from the code, write/update its doc and add a line here — don't inline the detail.

## Project

DarcStar Technologies marketing website — SvelteKit (Svelte 5) on **Cloudflare Pages**. Still close to a fresh `sv create` scaffold; most of `src/routes` and `src/stories` is template/demo content.

Non-negotiables:

- Package manager is **pnpm** (pinned in `packageManager`; `.npmrc` sets `engine-strict=true`). Use `pnpm`, never `npm`.
- **Svelte 5 runes only** — runes mode is forced project-wide. No legacy `export let`. See [docs/svelte.md](docs/svelte.md).

## Map

| Area                                           | Doc                                                            |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Commands & tests                               | [docs/commands.md](docs/commands.md)                           |
| Svelte conventions (runes, mdsvex, Svelte MCP) | [docs/svelte.md](docs/svelte.md)                               |
| i18n — Paraglide / inlang                      | [docs/i18n.md](docs/i18n.md)                                   |
| Styling & UI — Tailwind v4, Skeleton v4        | [docs/styling.md](docs/styling.md)                             |
| SEO — head tags & OG/Twitter social card       | [docs/seo.md](docs/seo.md)                                     |
| Contact form — modal → Turso                   | [docs/contact.md](docs/contact.md)                             |
| Auth — Better Auth (server-only, locked down)  | [docs/auth.md](docs/auth.md)                                   |
| Deployment — Cloudflare                        | [docs/deployment.md](docs/deployment.md)                       |
| Skeleton LLM reference (large)                 | [docs/llms/skeleton-svelte.txt](docs/llms/skeleton-svelte.txt) |

## Lessons

Durable gotchas — keep to one line; link to the doc that carries the detail.

- Keep `@tailwindcss/forms`; Skeleton's form components depend on it. → [styling](docs/styling.md)
- Site is **dark-only**: `data-mode="dark"` hardcoded on `<html>` in `app.html`, no toggle. Distinct from `data-theme` (palette). → [styling](docs/styling.md)
- Palette is the **custom `darcstar` Skeleton theme** (`src/themes/darcstar.css`); regenerate ramps via `node scripts/gen-theme.mjs`, don't hand-edit. → [styling](docs/styling.md)
- The RGB **color-charge triad has ONE source** — the theme (`tertiary`/`secondary`/`primary` = R/G/B). `--charge-*` and `CosmicBackdrop`'s canvas both derive from `--color-*-500`; never re-type the hexes. → [styling](docs/styling.md)
- **Brand type is self-hosted** (Space Grotesk / Inter / JetBrains Mono via Fontsource `@import` in `layout.css` — CSS, not a JS import, or svelte-check chokes). Body/heading tokens live in `gen-theme.mjs`; mono/sans in `layout.css` `@theme`; bare `<h1>`–`<h6>` need the base-layer rule (Skeleton styles only `.h1`–`.h6`). → [styling](docs/styling.md)
- **Every page's hero uses one pattern**: `eyebrow` → `#helix-slot` (CosmicBackdrop centres the RGB helix there) → heading+lede in a **`glass-panel`** below the helix. Match the homepage/`/about`; never a bare centered heading. → [styling](docs/styling.md)
- `pnpm preview` runs the built worker on the real Workers runtime (Wrangler), not `vite preview`. → [commands](docs/commands.md)
- Run `pnpm gen` after changing `wrangler.jsonc` bindings to refresh the `Env` type. → [deployment](docs/deployment.md)
- Changing the DB schema? Run `pnpm db:generate` + commit the `drizzle/` migration — the **`drizzle` CI check** (+ a pre-commit hook) regenerates offline and fails on drift, gating merge→prod. `db:push` stays the default apply path. → [deployment](docs/deployment.md)
- `checkJs` is **off** — generated Paraglide `.js` clashes with the Cloudflare `Request` global; no hand-written `.js` exists, so `.js` bodies aren't checked. → [i18n](docs/i18n.md)
- **All UI copy lives in Paraglide messages** (`messages/*.json`); the `local/no-raw-text` ESLint rule blocks hardcoded `.svelte` text/attrs (Wordmark exempt). `es` is untranslated placeholder → non-base locales are `noindex` via `Seo.svelte`'s `TRANSLATED_LOCALES` flag; hreflang deferred until `es` is real. → [i18n](docs/i18n.md)
- e2e builds + previews the Cloudflare bundle; match the vitest project to your filename (`client` / `server` / `storybook`). → [commands](docs/commands.md)
- Use the Svelte MCP (list-sections → get-documentation) for Svelte/SvelteKit questions; run svelte-autofixer on any Svelte you write. → [svelte](docs/svelte.md)
- Page head (title/description/OG/Twitter) comes from one `<Seo>` component — render it **once per page** in `+page.svelte`, never the layout (SvelteKit merges heads → duplicate tags). OG card is `node scripts/gen-og.mjs` (Chromium rasterizes the brand to 1200×630 PNG). → [seo](docs/seo.md)
- Contact CTAs open **one** modal (`ContactDialog`, rendered in the layout) via the `contactDialog` rune; it submits through a SvelteKit **remote `form`** (`contact.remote.ts`) → `contact_submission` in Turso, with a honeypot + IP/time throttle, then a **fire-and-forget Resend email** to `info@` (`contact-notify.ts`, via `ctx.waitUntil` — never fails the submission; needs `RESEND_API_KEY` + a verified Resend domain). `.remote.ts` may live anywhere except `$lib/server`. Run `pnpm db:push` after schema changes (the default apply path; `pnpm db:generate`+`db:migrate` write/apply a versioned `drizzle/` trail when wanted — see [deployment](docs/deployment.md)). → [contact](docs/contact.md)
- **Better Auth gates the `/admin` submissions view (#69)** — email/password sign-in exists, but **public sign-up stays disabled** (`disableSignUp`); the only way to make an operator is `pnpm admin:create`. Sign-in is a **server form action** (`login/+page.server.ts`, shared `LoginForm`) that works **without JS** and forwards to `getAuth().handler()` so it stays on the router's **DB-backed rate limiter** (`rateLimit.storage: 'database'` → `rate_limit` table; a direct `auth.api` call would skip it) and forwards the session `Set-Cookie` back. `handleBetterAuth` populates `locals.user` for `/api/auth/*` + `/admin` + `/login` (de-localized match) **or any request carrying a session cookie** (`getSessionCookie` — header-only, no DB), but mounts the API only under `/api/auth/*`; anonymous visitors (no cookie) still skip the lookup (#48 win preserved). Run `pnpm db:push` (adds `rate_limit`) + `pnpm admin:create` before the admin area works. → [auth](docs/auth.md)
- **The navbar reflects auth state** — root `+layout.server.ts` exposes a minimal `page.data.user` (`{ email }` or null; typed in `app.d.ts`), so `Header.svelte` swaps "Sign in" for **Admin + Sign out** when signed in. Global sign-out is `routes/logout/+server.ts` (native form POST → `auth.api.signOut` → `/`). `pnpm smoke:signin` asserts both nav states. → [auth](docs/auth.md)
- **Operator-roster management is the Better Auth `admin` plugin** — `/admin/users` (+`[id]`) does list/create/edit/role/reset-password/force-logout/disable/delete via no-JS `auth.api.*` form actions. **Two roles**: `admin` manages + views submissions, `user` (operator) only views. **Owner bootstrap = `ADMIN_USER_IDS`** env allowlist (admin before any role check → can't be locked out; `admin-access.ts` `isRosterAdmin`); it's a runtime var, so add to `.env` + `pnpm gen`, `wrangler secret put` in prod. The plugin is **schema-affecting** (adds `user.role/banned/…` + `session.impersonated_by`) → bare `admin()` mirrored in `auth-cli.ts`, `pnpm db:push` adds the columns. Authz is **authoritative** (bypasses cookie-cache); UI self/owner guardrails aren't a hard boundary (raw `/api/auth/admin/*` has no owner concept). → [auth](docs/auth.md)
