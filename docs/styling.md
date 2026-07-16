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
- The homepage void (black + starfield + twisting RGB triple helix) lives in `src/lib/components/CosmicBackdrop.svelte`; its accent colors are **read from the theme tokens at runtime** (`getComputedStyle` → `--color-{tertiary,secondary,primary}-500`), so the canvas never hardcodes the triad — see the design-system section below.

**Reference** — Skeleton's official LLM doc is at [`llms/skeleton-svelte.txt`](llms/skeleton-svelte.txt) (component APIs + design-system tokens). Skeleton ships no dedicated MCP; use the Svelte MCP (see [svelte.md](svelte.md)) for Svelte/SvelteKit questions.

## Design system

**Skeleton is the system, not dead weight.** The `darcstar` theme is the single source of truth for colour; new UI should reach for Skeleton tokens (`text-surface-*`, `bg-surface-*`, `*-primary-500`, `preset-*`, `btn`, `card`, …) and the glass utilities below rather than inventing one-off values. Skeleton components are used where they earn their keep (e.g. the header's `btn-icon` / `preset-tonal`); the theme's token layer is used everywhere.

### The color-charge triad — one source of truth

The homepage's RGB "color-charge" motif (the nucleon triple helix) is **the same three colours as the brand triad**, defined once in the theme and consumed everywhere via derivation — never re-typed as hex:

| Charge | Theme family (source of truth) | 500 token               | Hue       |
| ------ | ------------------------------ | ----------------------- | --------- |
| **R**  | `tertiary`                     | `--color-tertiary-500`  | rose      |
| **G**  | `secondary`                    | `--color-secondary-500` | green     |
| **B**  | `primary`                      | `--color-primary-500`   | cyan-blue |

- **Edit the colours in one place:** the base hexes in `scripts/gen-theme.mjs`; run `node scripts/gen-theme.mjs` to regenerate `src/themes/darcstar.css`. Do not hand-edit the ramps.
- **CSS consumers** use the semantic aliases `--charge-r/g/b` (declared in `layout.css` `:root`), which are just `var(--color-{tertiary,secondary,primary}-500)`. They read better than the raw family names for the hero's physics metaphor, but carry no colour of their own.
- **The canvas** (`CosmicBackdrop.svelte`) reads the same `--color-*-500` tokens at runtime via `getComputedStyle`, so there is no JS copy of the palette to drift. Values resolve as `oklch()` strings (canvas 2D parses them); `withAlpha()` appends the alpha channel for the nebula glows.

### Glass surfaces — `glass-panel` / `glass-btn`

Two `@utility` classes in `layout.css` render the frosted panes that float over the void: `glass-panel` (sections, header, readout bar) and `glass-btn` (CTAs). Both compose a translucent fill, the shared `--grain` film, a faint R→G→B tint, `backdrop-filter: blur`, and a colour-charge drop shadow.

**Contrast-safe text rules.** These panels sit on the near-black void with a heavy blur, so foreground text is **pure white at graded opacity** (a deliberate, consistent hierarchy — not token drift):

- `text-white` — primary headings.
- `text-white/55` (`/50` on tighter blocks) — body copy.
- `text-white/40` / `text-white/35` — mono kickers, labels, and readout captions.

Keep body text at **≥ 55%** opacity and reserve `< 40%` for large-tracking mono labels only; below that, white-on-glass drops under a comfortable contrast ratio. Accent (non-white) text uses the triad via `.charge-flow`. When a surface is _not_ glass-over-void (e.g. a future light section), use Skeleton's `text-surface-*` contrast tokens instead of white-at-opacity.
