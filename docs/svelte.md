# Svelte / framework conventions

## Runes mode (forced)

Runes mode is forced project-wide via `vite.config.ts` compilerOptions (except `node_modules`), and Svelte `experimental.async` + SvelteKit `experimental.remoteFunctions` / `handleRenderingErrors` are enabled. Write Svelte 5 runes syntax (`$state`, `$props`, `$derived`, etc.), **not** legacy `export let`.

## Content (mdsvex)

`mdsvex` is configured, so `.md` and `.svx` files are valid Svelte components/routes (`extensions` includes both).

## Svelte MCP server

The official Svelte MCP server provides comprehensive Svelte 5 / SvelteKit documentation and code checking. Use it for any Svelte/SvelteKit work:

- **list-sections** — call FIRST to discover documentation sections (returns titles, use_cases, paths).
- **get-documentation** — fetch full content for all sections relevant to the task found above.
- **svelte-autofixer** — run on any Svelte code you write, and keep calling until it returns no issues or suggestions.
- **playground-link** — generate a Playground link, only after user confirmation, and never for code already written to project files.
