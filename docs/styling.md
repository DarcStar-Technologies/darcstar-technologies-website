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

## Typography

The site ships **three self-hosted brand faces** (issue #17) — no `system-ui`, no Google CDN:

| Role        | Face           | Where it applies                                        | Token (source of truth)                           |
| ----------- | -------------- | ------------------------------------------------------- | ------------------------------------------------- |
| **Display** | Space Grotesk  | all headings (`<h1>`–`<h6>`)                            | `--heading-font-family` — `scripts/gen-theme.mjs` |
| **Body**    | Inter          | body copy + UI (`<body>` down)                          | `--base-font-family` — `scripts/gen-theme.mjs`    |
| **Mono**    | JetBrains Mono | `font-mono` — GIDE kicker, section kickers, readout bar | `--font-mono` — `layout.css` `@theme`             |

**Self-hosting** — the faces load via [Fontsource](https://fontsource.org) variable packages (`@fontsource-variable/{space-grotesk,inter,jetbrains-mono}`), imported as **CSS `@import` at the top of `layout.css`** (not a JS side-effect import in `+layout.svelte`). Fontsource ships the variable `.woff2` + `@font-face` (`font-display: swap`); Vite fingerprints and bundles the files, and the per-subset `unicode-range` means an English visitor downloads only the **latin** woff2 per family (~3 files). Each is a single variable file spanning all weights the site uses (Space Grotesk `300–700` covers `font-medium`/`font-semibold`).

- **Why CSS `@import`, not `import '@fontsource-variable/…'` in the layout script:** under `moduleResolution: bundler` the specifier resolves straight to the package's `index.css`, and svelte-check errors on the untyped side-effect import ("Cannot find module or type declarations…"). An ambient `declare module` can't shadow a specifier that already resolves to a file, so the fix is to keep font loading in CSS, which is never type-checked.

**The token split — two files, one contract (the family names):**

- **Body + heading** are Skeleton tokens (`--base-font-family` / `--heading-font-family`), set in `scripts/gen-theme.mjs` and emitted into `src/themes/darcstar.css`. Edit the `GLOBAL` block and rerun `node scripts/gen-theme.mjs` — **don't hand-edit the generated theme.**
- **Mono + sans** are Tailwind's `--font-mono` / `--font-sans`, set in the `@theme` block in `layout.css` (that's what the `font-mono` / `font-sans` utilities resolve to).
- **Headings need a base-layer nudge.** Skeleton wires `--heading-font-family` only to its `.h1`–`.h6` _utility classes_, but this site writes semantic `<h1>`–`<h6>` with Tailwind `text-*` sizing. A small `@layer base { h1,…,h6 { font-family: var(--heading-font-family) } }` rule in `layout.css` maps the elements to the display face (same token — no second source).

**Changing a face** — `pnpm add -D @fontsource-variable/<name>`, add its `@import` to `layout.css`, and point the relevant token (theme token via `gen-theme.mjs`, or `--font-mono`/`--font-sans` in the `@theme` block) at the new `'<Name> Variable'` family.

## Dark mode

**The site is dark-only** (product decision) — there is no light theme and no toggle. `data-mode="dark"` is hardcoded on `<html>` in `src/app.html`, so the `darcstar` dark tokens and `dark:` utilities always resolve.

- **Variant** — `layout.css` declares `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));`. Kept so the theme's dark tokens resolve; since `data-mode` is always `dark`, prefer plain (non-`dark:`) utilities in new markup.
- `data-mode` (light/dark) and `data-theme` (which palette, i.e. `darcstar`) are independent — a theme defines both its light and dark colors; we only ever use the dark half.
- The homepage void (black + starfield + twisting RGB triple helix) lives in `src/lib/components/CosmicBackdrop.svelte`; its accent colors are **read from the theme tokens at runtime** (`getComputedStyle` → `--color-{tertiary,secondary,primary}-500`), so the canvas never hardcodes the triad — see the design-system section below.
- **Backdrop perf — the canvas is GPU-aware.** The `fixed inset-0` canvas animates _behind_ the glass panels, and each `backdrop-filter: blur()` layer must re-blur it every frame it changes (measured ~1.6× the viewport re-composited per frame — the dominant GPU cost on the page, not the canvas draw itself). `CosmicBackdrop` fights this on several fronts:
  - **Fully stops** the rAF loop while the tab is hidden (`visibilitychange`), the contact modal is open (its full-viewport scrim + panel would re-blur the live canvas every frame), or reduced-motion is set.
  - **Switches to a cheap helix-only draw** once the hero `<section>` scrolls out of view (`IntersectionObserver`): the helix keeps turning, but the starfield freezes and only the helix's band repaints — restored from a cached frozen backdrop — so the compositor invalidates just that strip and the panels stop re-blurring the whole canvas.
  - **Trims the per-frame cost**: the static layers (black + nebula glows + the vignette gradient) are cached to an offscreen canvas and blitted instead of rebuilt; the helix glow is an additive stroke pass rather than a per-segment `shadowBlur`; the loop runs at 24fps.

  The lesson: **animated content behind many/large `backdrop-filter` layers is a GPU multiplier** — keep the blur areas small, and freeze or shrink the animating region when it isn't the focus.

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
- **`.charge-flow` (clipped gradient text on "prove" / "Technologies") is the one exception to `-500`.** Over the translucent glass, the `-500` rose stop and the R→B blend dip to ~3.3:1 — marginal on the 20px header (issue #21). It uses the brighter **`-300`** steps of the same theme hues (local `--flow-r/b/g` aliases) so every point of the animated cycle clears ~5:1 (AA with margin under the blurred backdrop) — still the theme ramp, no re-typed hexes. The shimmer loops continuously; `prefers-reduced-motion` drops it to a static gradient (one consolidated reduced-motion block at the foot of `layout.css` covers `.charge-flow` and `.glass-nav`).

### Glass surfaces — `glass-panel` / `glass-nav` / `glass-btn`

Three `@utility` classes in `layout.css` render the frosted panes that float over the void: `glass-panel` (sections, readout bar), `glass-nav` (the sticky header), and `glass-btn` (CTAs). All compose a translucent fill, the shared `--grain` film, `backdrop-filter: blur`, and a lift shadow. Two more serve the contact form (see [contact](contact.md)): **`glass-field`** is the _inverse_ — form inputs carved **into** the glass via inset (rather than lift) shadows (darker fill + grain, dark top-inner depth shadow + light bottom-inner bevel, primary/error focus rings); **`glass-menu`** is a floating dropdown/popover surface — like `glass-panel` but with a **more opaque** dark base, because it floats over busy content (form fields) rather than the void, so `glass-panel`'s ~4% fill would let text bleed through. It keeps the grain + sheen + heavy blur + lift so it still reads as frosted glass while staying legible.

`glass-panel` and `glass-btn` also carry a faint R→G→B charge tint and a colour-charge drop shadow, sized for large panes. **`glass-nav` deliberately drops both.** The panel's 84px black halo + spread R/G/B glow were tuned for the hero panes; on the thin sticky bar they smeared over the page and floated as you scrolled (issue #20). The nav keeps only the frosted blur, grain, and top sheen over a thin border — so reach for `glass-nav`, not `glass-panel`, on any slim always-visible chrome.

`glass-nav`'s drop shadow is **shadow-on-scroll**: it's flat at the top of the page (the bar sits over the hero, nothing to lift off) and fades in a tight, neutral shadow once the header detaches from the top. `Header.svelte` toggles `data-stuck` on the `<nav>` via an `IntersectionObserver` watching a 0-height sentinel pinned at document top — so there is **no per-scroll handler**, only a fire as the header crosses the top edge (`.glass-nav[data-stuck='true']` carries the lifted shadow; the transition respects `prefers-reduced-motion`).

**Contrast-safe text rules (WCAG AA).** These panels sit on the near-black void with a heavy blur, and the faint R→G→B charge tint _lightens_ patches of the pane — which **lowers** contrast for white text. Foreground text is **pure white at graded opacity** (a deliberate, consistent hierarchy — not token drift), floored so even the lightened patches clear AA (4.5:1 for normal-size body and labels):

- `text-white` — headings and primary readout values.
- `text-white/70` — **body-copy floor** (hero lede, pillar/domain/section copy). The old `/55`–`/50` computed ~4.4:1 _at best_ and less over tinted patches — under AA (issue #16).
- `text-white/60` at **≥ 12px** (`text-xs`) — mono kickers, tracked labels, readout captions. The old `/40`–`/35`, some at 11px, were well under AA.
- **`< white/50` is decoration only** — borders, dividers, hover fills (`border-white/10`, `divide-white/10`, `hover:bg-white/10`). Never body text or labels.

Keep body text at **≥ 70%** and labels at **≥ 60% / 12px**; below those, white-on-glass drops under AA over the tinted patches. Accent (non-white) text uses the triad via `.charge-flow` (itself floored to the brighter `-300` steps for the same reason — see the triad section). When a surface is _not_ glass-over-void (e.g. a future light section), use Skeleton's `text-surface-*` contrast tokens instead of white-at-opacity.
