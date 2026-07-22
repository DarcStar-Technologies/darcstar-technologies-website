# DarcStar Technologies — website

Marketing site for DarcStar Technologies, built with **SvelteKit (Svelte 5 runes)** and deployed to **Cloudflare Workers**.

## Stack

- **SvelteKit** on `@sveltejs/adapter-cloudflare` (Cloudflare Workers)
- **Tailwind CSS v4** + **Skeleton v4** — custom `darcstar` theme, dark-only
- **Turso** (libSQL) via **Drizzle ORM** — contact submissions + auth tables
- **Better Auth** — gated `/admin` (submissions + operator roster) and `/account` (end-user portal)
- **Paraglide (inlang)** — i18n; all UI copy lives in `messages/*.json`
- **Resend** — contact lead + acknowledgement emails

## Prerequisites

- **pnpm** — this repo is pnpm-only (`engine-strict` is on); never use `npm`.
- A local `.env` (copy `.env.example`) pointing at the **dev** Turso DB + auth secrets.

## Develop

```sh
pnpm install
pnpm dev            # Vite dev server
pnpm preview        # build + serve the real Workers bundle via Wrangler (not `vite preview`)
```

## Common commands

| Command                     | What                                     |
| --------------------------- | ---------------------------------------- |
| `pnpm check`                | `svelte-check` (types)                   |
| `pnpm lint` / `pnpm format` | Prettier + ESLint                        |
| `pnpm test`                 | unit (Vitest) + e2e (Playwright)         |
| `pnpm db:push`              | apply the schema to the dev DB (Drizzle) |
| `pnpm storybook`            | component stories                        |

Full list: **[docs/commands.md](docs/commands.md)**.

## How it fits together

The detail lives in `docs/` (indexed by [`CLAUDE.md`](CLAUDE.md)):

- **[Deployment & environments](docs/deployment.md)** — the prod/dev Turso split, the `deploy-prod` migrate-before-deploy Action, and the Cloudflare setup
- **[Styling](docs/styling.md)** · **[Svelte conventions](docs/svelte.md)** · **[i18n](docs/i18n.md)** · **[SEO](docs/seo.md)** · **[Contact](docs/contact.md)** · **[Auth](docs/auth.md)**

## Conventions

- **Svelte 5 runes only** — runes mode is forced project-wide; no legacy `export let`.
- **All UI copy is Paraglide messages** (`messages/*.json`); the `local/no-raw-text` ESLint rule blocks hardcoded text in `.svelte` files.
- Changing the DB schema? Run `pnpm db:generate` and commit the `drizzle/` migration (a CI check + pre-commit hook enforce it). See [docs/deployment.md](docs/deployment.md).
