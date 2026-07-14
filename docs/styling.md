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

Data-attribute strategy (`data-mode` on `<html>`), following Skeleton's Light Switch recipe. Both `dark:` utilities and color pairings (`bg-primary-50-950`, …) respond to it.

- **Variant** — `layout.css` declares `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));`.
- **No flash** — an inline script in `src/app.html` `<head>` sets `data-mode` from `localStorage.mode` (falling back to `prefers-color-scheme`) before first paint.
- **Toggle** — `src/lib/components/ThemeToggle.svelte` (Skeleton `Switch` + sun/moon icons) writes `data-mode` and persists `localStorage.mode` (key: `mode`, values `light` / `dark`). It reads the initial state from the DOM that the no-flash script already set. Rendered in the site header (`src/lib/components/Header.svelte`), which `src/routes/+layout.svelte` mounts on every page.
- `data-mode` (light/dark) and `data-theme` (which palette, e.g. `cerberus`) are independent — a theme defines both its light and dark colors.

**Reference** — Skeleton's official LLM doc is at [`llms/skeleton-svelte.txt`](llms/skeleton-svelte.txt) (component APIs + design-system tokens). Skeleton ships no dedicated MCP; use the Svelte MCP (see [svelte.md](svelte.md)) for Svelte/SvelteKit questions.
