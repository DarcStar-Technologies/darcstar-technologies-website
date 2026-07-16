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
@import '../themes/darcstar.css';

@plugin '@tailwindcss/forms';
@plugin '@tailwindcss/typography';
```

**Theme** — **custom `darcstar` theme** (`src/themes/darcstar.css`), set via `data-theme="darcstar"` on `<html>` in `src/app.html`. It maps Skeleton's `primary`/`secondary`/`tertiary` to the RGB color-charge triad (cyan-blue / green / rose) and `surface` to a cool near-black void; `success`/`warning`/`error` keep sensible semantic defaults. The OKLCH ramps are generated — edit the base hexes in `scripts/gen-theme.mjs` and run `node scripts/gen-theme.mjs` to regenerate (don't hand-edit the ramp values). See [Skeleton themes](https://skeleton.dev) for the token format.

**Usage** — components: `import { Foo } from '@skeletonlabs/skeleton-svelte'`. Design-system utility classes (`.btn`, `.card`, `preset-*`, `.input`) come from the core package.

**Lesson: keep `@tailwindcss/forms`** — Skeleton's form components depend on it; removing it breaks them.

## Dark mode

**The site is dark-only** (product decision) — there is no light theme and no toggle. `data-mode="dark"` is hardcoded on `<html>` in `src/app.html`, so the `darcstar` dark tokens and `dark:` utilities always resolve.

- **Variant** — `layout.css` declares `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));`. Kept so the theme's dark tokens resolve; since `data-mode` is always `dark`, prefer plain (non-`dark:`) utilities in new markup.
- `data-mode` (light/dark) and `data-theme` (which palette, i.e. `darcstar`) are independent — a theme defines both its light and dark colors; we only ever use the dark half.
- The homepage void (black + starfield + twisting RGB triple helix) lives in `src/lib/components/CosmicBackdrop.svelte`; its accent colors mirror the `--charge-r/g/b` vars in `layout.css`, which are the same three colors the theme's `primary`/`secondary`/`tertiary` are built from.

**Reference** — Skeleton's official LLM doc is at [`llms/skeleton-svelte.txt`](llms/skeleton-svelte.txt) (component APIs + design-system tokens). Skeleton ships no dedicated MCP; use the Svelte MCP (see [svelte.md](svelte.md)) for Svelte/SvelteKit questions.
