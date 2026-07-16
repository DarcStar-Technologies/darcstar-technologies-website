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
| Deployment — Cloudflare                        | [docs/deployment.md](docs/deployment.md)                       |
| Skeleton LLM reference (large)                 | [docs/llms/skeleton-svelte.txt](docs/llms/skeleton-svelte.txt) |

## Lessons

Durable gotchas — keep to one line; link to the doc that carries the detail.

- Keep `@tailwindcss/forms`; Skeleton's form components depend on it. → [styling](docs/styling.md)
- Site is **dark-only**: `data-mode="dark"` hardcoded on `<html>` in `app.html`, no toggle. Distinct from `data-theme` (palette). → [styling](docs/styling.md)
- `pnpm preview` runs the built worker on the real Workers runtime (Wrangler), not `vite preview`. → [commands](docs/commands.md)
- Run `pnpm gen` after changing `wrangler.jsonc` bindings to refresh the `Env` type. → [deployment](docs/deployment.md)
- e2e builds + previews the Cloudflare bundle; match the vitest project to your filename (`client` / `server` / `storybook`). → [commands](docs/commands.md)
- Use the Svelte MCP (list-sections → get-documentation) for Svelte/SvelteKit questions; run svelte-autofixer on any Svelte you write. → [svelte](docs/svelte.md)
