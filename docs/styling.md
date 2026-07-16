# Styling — Tailwind v4 + Skeleton v4

## Tailwind CSS v4

Via the Vite plugin. The stylesheet entry is `src/routes/layout.css` (Prettier's `tailwindStylesheet` points here for class sorting). The `@tailwindcss/forms` and `@tailwindcss/typography` plugins are enabled.

## Skeleton v4 (UI toolkit)

`@skeletonlabs/skeleton` (core design system) + `@skeletonlabs/skeleton-svelte` (Svelte 5 components), built on Tailwind v4.

**Wiring** — `src/routes/layout.css` imports Skeleton core, the Svelte package, and a theme:

```css
@import 'tailwindcss';

@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';
@import '@skeletonlabs/skeleton/themes/cerberus';

@plugin '@tailwindcss/forms';
@plugin '@tailwindcss/typography';
```

**Theme** — set via `data-theme="cerberus"` on `<html>` in `src/app.html`. To switch: add another `@import '@skeletonlabs/skeleton/themes/<name>';` in `layout.css` and change the `data-theme` value (built-in themes include `catppuccin`, `nosh`, `pine`, `rose`, `vintage`, …).

**Usage** — components: `import { Foo } from '@skeletonlabs/skeleton-svelte'`. Design-system utility classes (`.btn`, `.card`, `preset-*`, `.input`) come from the core package.

**Lesson: keep `@tailwindcss/forms`** — Skeleton's form components depend on it; removing it breaks them.

## Dark mode

**The site is dark-only** (product decision) — there is no light theme and no toggle. `data-mode="dark"` is hardcoded on `<html>` in `src/app.html`, so Skeleton's cerberus dark tokens and `dark:` utilities always resolve.

- **Variant** — `layout.css` declares `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));`. Kept so Skeleton/cerberus dark tokens resolve; since `data-mode` is always `dark`, prefer plain (non-`dark:`) utilities in new markup.
- `data-mode` (light/dark) and `data-theme` (which palette, e.g. `cerberus`) are independent — a theme defines both its light and dark colors; we only ever use the dark half.
- The homepage void (black + starfield + twisting RGB triple helix) lives in `src/lib/components/CosmicBackdrop.svelte`; its accent colors mirror the `--charge-r/g/b` vars in `layout.css`.

**Reference** — Skeleton's official LLM doc is at [`llms/skeleton-svelte.txt`](llms/skeleton-svelte.txt) (component APIs + design-system tokens). Skeleton ships no dedicated MCP; use the Svelte MCP (see [svelte.md](svelte.md)) for Svelte/SvelteKit questions.
