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

**Self-hosting** — the faces load via [Fontsource](https://fontsource.org) variable packages (`@fontsource-variable/{space-grotesk,inter,jetbrains-mono}`), imported as **CSS `@import` at the top of `layout.css`** (not a JS side-effect import in `+layout.svelte`). Fontsource ships the variable `.woff2` + `@font-face` (`font-display: swap`); Vite fingerprints and bundles the files, and the per-subset `unicode-range` means an English visitor downloads only the **latin** woff2 per family (~3 files). Each is a single variable file spanning all weights the site uses (Space Grotesk `300–700` covers `font-medium`/`font-semibold`). The three latin faces are also **preloaded** (DAR-50): `hooks.server.ts` wires `$lib/server/preload.ts`'s filter into `resolve()`, emitting a `Link: rel="preload"` response header the browser acts on before the CSS is even fetched — without it the fonts sit at the end of the first-paint critical path (HTML → CSS → layout → `@font-face` fetch), which is what capped mobile FCP/LCP. Latin **normal** only — every other subset (and any future italic) stays lazy behind its `unicode-range`; the boundary is pinned by `preload.spec.ts`. (Cloudflare can upgrade the header to 103 Early Hints where the zone setting is enabled; the win doesn't depend on it.)

- **Why CSS `@import`, not `import '@fontsource-variable/…'` in the layout script:** under `moduleResolution: bundler` the specifier resolves straight to the package's `index.css`, and svelte-check errors on the untyped side-effect import ("Cannot find module or type declarations…"). An ambient `declare module` can't shadow a specifier that already resolves to a file, so the fix is to keep font loading in CSS, which is never type-checked.

**The token split — two files, one contract (the family names):**

- **Body + heading** are Skeleton tokens (`--base-font-family` / `--heading-font-family`), set in `scripts/gen-theme.mjs` and emitted into `src/themes/darcstar.css`. Edit the `GLOBAL` block and rerun `node scripts/gen-theme.mjs` — **don't hand-edit the generated theme.**
- **Mono + sans** are Tailwind's `--font-mono` / `--font-sans`, set in the `@theme` block in `layout.css` (that's what the `font-mono` / `font-sans` utilities resolve to).
- **Headings need a base-layer nudge.** Skeleton wires `--heading-font-family` only to its `.h1`–`.h6` _utility classes_, but this site writes semantic `<h1>`–`<h6>` with Tailwind `text-*` sizing. A small `@layer base { h1,…,h6 { font-family: var(--heading-font-family) } }` rule in `layout.css` maps the elements to the display face (same token — no second source).

**Changing a face** — `pnpm add -D @fontsource-variable/<name>`, add its `@import` to `layout.css`, and point the relevant token (theme token via `gen-theme.mjs`, or `--font-mono`/`--font-sans` in the `@theme` block) at the new `'<Name> Variable'` family. A new latin variable face is preloaded automatically — the `$lib/server/preload.ts` filter matches Fontsource's `*-latin-wght-normal.*` filename convention, so revisit it (and its spec) only if the face isn't Fontsource-named.

## Dark mode

**The site is dark-only** (product decision) — there is no light theme and no toggle. `data-mode="dark"` is hardcoded on `<html>` in `src/app.html`, so the `darcstar` dark tokens and `dark:` utilities always resolve.

- **Variant** — `layout.css` declares `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));`. Kept so the theme's dark tokens resolve; since `data-mode` is always `dark`, prefer plain (non-`dark:`) utilities in new markup.
- `data-mode` (light/dark) and `data-theme` (which palette, i.e. `darcstar`) are independent — a theme defines both its light and dark colors; we only ever use the dark half.
- The homepage void (black + starfield + twisting RGB triple helix) lives in `src/lib/components/CosmicBackdrop.svelte`; its accent colors are **read from the theme tokens at runtime** (`getComputedStyle` → `--color-{tertiary,secondary,primary}-500`), so the canvas never hardcodes the triad — see the design-system section below.
- **Backdrop perf — the canvas is GPU-aware.** The `fixed inset-0` canvas animates _behind_ the glass panels, and each `backdrop-filter: blur()` layer must re-blur it every frame it changes (measured ~1.6× the viewport re-composited per frame — the dominant GPU cost on the page, not the canvas draw itself). `CosmicBackdrop` fights this on several fronts:
  - **Fully stops** the rAF loop while the tab is hidden (`visibilitychange`), the contact modal is open (its full-viewport scrim + panel would re-blur the live canvas every frame), or reduced-motion is set.
  - **Switches to a cheap helix-only draw** once the hero `<section>` scrolls out of view (`IntersectionObserver`): the helix keeps turning, but the starfield freezes and only the helix's band repaints — restored from a cached frozen backdrop — so the compositor invalidates just that strip and the panels stop re-blurring the whole canvas.
  - **Trims the per-frame cost**: the static layers (black + nebula glows + the vignette gradient) are cached to an offscreen canvas and blitted instead of rebuilt; the helix glow is an additive stroke pass rather than a per-segment `shadowBlur`; the loop runs at 24fps.
  - **Defers first-load main-thread work (DAR-50)**: init runs one rAF after the attachment, off the root layout's hydration task (the reduced-motion read stays synchronous in the attachment so the preference remains a tracked dependency), and the frozen scroll-away frame is composed **lazily on first need**, not at init — while the hero is visible it's never read.

  The lesson: **animated content behind many/large `backdrop-filter` layers is a GPU multiplier** — keep the blur areas small, and freeze or shrink the animating region when it isn't the focus.

**Reference** — Skeleton's official LLM doc is at [`llms/skeleton-svelte.txt`](llms/skeleton-svelte.txt) (component APIs + design-system tokens). Skeleton ships no dedicated MCP; use the Svelte MCP (see [svelte.md](svelte.md)) for Svelte/SvelteKit questions.

## Design system

**Skeleton is the system, not dead weight.** The `darcstar` theme is the single source of truth for colour; new UI should reach for Skeleton tokens (`text-surface-*`, `bg-surface-*`, `*-primary-500`, `preset-*`, `btn`, `card`, …), the semantic tokens/utilities below, and the glass utilities rather than inventing one-off values. Skeleton components are used where they earn their keep (e.g. the header's `btn-icon` / `preset-tonal`); the theme's token layer is used everywhere.

### Semantic ink scale — the on-void text opacities

Translucent-white text over the dark void used to be hand-typed as `text-white/NN` at ~30 sites. It's now a named scale in the `@theme` block of `layout.css` (`--color-*` → Tailwind `text-*`/`border-*` utilities). **Use these, not raw `text-white/NN`:**

| Utility           | Value       | Use                                                 |
| ----------------- | ----------- | --------------------------------------------------- |
| `text-white`      | 1.0         | headings                                            |
| `text-emphasis`   | white / 0.8 | prominent secondary text                            |
| **`text-body`**   | white / 0.7 | body copy — **WCAG-AA floor**                       |
| **`text-muted`**  | white / 0.6 | labels / eyebrows — **WCAG-AA floor**               |
| `text-faint`      | white / 0.5 | de-emphasised hints                                 |
| `text-subtle`     | white / 0.4 | placeholders / disabled                             |
| `border-hairline` | white / 0.1 | 1px dividers / panel edges (also `divide-hairline`) |

`body` and `muted` are the documented AA floors (body copy ≥ 0.7, labels ≥ 0.6) — staying on the token keeps text from silently dropping below them. The values equal the opacities they replaced, so it's a look-neutral rename.

### Named tiers — eyebrow, heading, pill, datagrid, action/confirm, badge

Six `@utility` families in `layout.css` (built with `@apply`) capture what were copy-pasted class runs. Most share a shape: a **composition root** holding the invariant, plus discrete tiers that add only what varies. The root is never a call-site class, and `styles.spec.ts` asserts that for each.

| Family                                                                  | Root (never used bare)                                   | Tiers                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **eyebrow** — the mono/caps kicker                                      | `eyebrow` = `font-mono uppercase text-muted`             | `eyebrow-hero` · `eyebrow-panel` · `eyebrow-label`                                           |
| **heading** — every `<h1>`–`<h6>`                                       | `heading-base` = `font-medium tracking-tight text-white` | `heading-page` · `heading-section` · `heading-subsection` · `heading-panel` · `heading-card` |
| **pill** — the CTA button, paired with a surface (`glass-btn btn-pill`) | `btn-pill-base` = `rounded-full font-medium text-white`  | `btn-pill` · `btn-pill-sm` · `btn-pill-xs`                                                   |
| **datagrid** — the /admin + /account record tables                      | _(none — `datagrid` is itself a call-site class)_        | `datagrid` · `datagrid-head` · `datagrid-th` · `datagrid-td` · `datagrid-empty`              |
| **action / confirm** — /admin's two-part controls                       | `confirm-base`, `action-base` (ghost adds the chrome)    | `action-*` · `confirm-*`, each in `affirm` · `caution` · `danger` · `quiet`                  |
| **badge** — small rounded labels                                        | `badge-base` (only two of the four compose off it)       | `badge-solid` · `badge-outline` · `badge-tag` · `badge-micro`                                |

**The /admin control is two parts that share a tone.** Almost every consequential action there is a `<details>` whose `<summary>` is a ghost trigger, plus a filled confirm button inside it. The tone is the action's severity — `affirm` invites, `caution` records a consent request, `danger` deletes, `quiet` expands or reverses — and the pair always matches, which is what makes the trigger's colour a promise about the button underneath. A spec enforces the pairing.

The ghost tier is `action-*` rather than `disclose-*` because one site ("Mark reviewed") is a bare `<button>` with nothing to disclose; the `<summary>` marker rules are inert there, but a name promising disclosure would have been false.

**Badges deliberately do _not_ all share a root.** The only token all four spellings have in common is `rounded-full`, and two of them are not `inline-flex` — making them so would change layout on the `<li>` chips. `badge-solid` and `badge-outline` compose off `badge-base`; `badge-tag` and `badge-micro` stand alone. A root that thin would be a configurable abstraction rather than a shared one.

**Why tiers rather than free composition.** Each family's comment used to say consumers add their own size and that the sizes legitimately varied. Measured, they did not:

| Family           | Ticket  | Call sites | Distinct combinations found |
| ---------------- | ------- | ---------- | --------------------------- |
| eyebrow          | DAR-218 | 22         | 3                           |
| heading          | DAR-222 | 57         | 21 → 5 tiers + 5 one-offs   |
| pill             | DAR-222 | 14         | 3                           |
| action / confirm | DAR-223 | 15         | 1 geometry × 4 tones        |
| badge            | DAR-223 | 15         | 5 → 4 named + 3 one-offs    |

Free variation that is never used as freedom is drift waiting to happen, and it happened: the `text-lg` heading tier had split into two spellings, one with `tracking-tight` and one without. That split was **not random** — every copy missing it was under `/admin/users` or `/account`, every copy keeping it under `/people`, `/research` or `/news` — which is the `/admin` opt-out (below) leaking past the surfaces it is scoped to. Unified; it moved eight headings by -0.025em.

A surface that genuinely needs a new size should **add a tier here**, not re-open a bracket at the call site.

**Deliberate one-offs stay one-offs.** Five headings are exempt with reasons pinned in `styles.spec.ts` (the three hero sizes, the topic-guide legend, the news card title), as are `/admin/users/[id]`'s two danger-zone buttons — an outline pill and a filled outline pill, one use each, whose difference encodes a disable-then-delete escalation that a shared token would flatten — and `PaperLinks`' external-source pill, which is a **link** with hover/focus states that the static badge family must never acquire.

**Naming a utility is a namespace decision (DAR-223).** Skeleton is a design system, not just a component library: it declares ~230 `@utility` names, and this site imports all of them. A same-named utility of ours does **not** shadow Skeleton's and does **not** error — both rules are emitted and the cascade decides per property, so the result is a silent merge. A `@utility badge` picked up Skeleton's `border-radius` and `padding-inline`, which is how the chips would have shipped with the wrong geometry; it is `badge-solid` now. The names Skeleton owns are exactly the ones you would reach for first: `badge` · `chip` · `card` · `table` · `btn` · `input` · `label` · `select` · `textarea` · `checkbox` · `radio` · `h1`–`h6`. `styles.spec.ts` reads Skeleton's vocabulary out of `node_modules` and asserts ours is disjoint from it.

**Shared class strings never live in a component (DAR-223).** `$lib/styles.ts` or a `@utility` — never an exported `<script module>` const, so no file has to import a component to get a string. Beyond the convention, `styles.spec.ts` reads `$lib/styles` **by importing it**, so a second module of shared strings is invisible to every rule in that file; a spec now fails on any class string exported from a component.

### Keyboard focus — one ring, plus `hover-focus:` (DAR-57)

Two rules in `layout.css`, and they answer different questions:

- **The ring says WHERE focus is.** One `@layer base` rule gives `a`/`button`/`summary`/`input`/`select`/`textarea` a `2px solid var(--color-primary-400)` outline at `:focus-visible`, offset 2px. Before it, nothing in the repo defined a focus style at all and every link fell back to the UA ring — Skeleton leaves this to the app on purpose (its `base/globals.css` ships the reminder and a commented example). Scope is **every interactive element**, not just anchors: branding the link ring and leaving buttons on the UA default trades a missing indicator for an inconsistent one.
- **`hover-focus:` says the thing IS interactive.** A `hover:`-only treatment — the research pills' fill, a card title's underline — tells a mouse user that and tells a keyboard user nothing. The custom variant fires on both. Its `@media (hover: hover)` guard is not decoration: Tailwind's own `hover:` compiles with it, so a raw `&:hover` would silently start applying hover styles on touch. It composes, so the news card's `group-hover:` became `group-hover-focus:`.

Three things worth keeping:

- **The ring is `@layer base` so a surface that owns its focus state still wins.** Tailwind utilities are a later layer, which is what leaves `glass-field`'s recessed ring and `/admin`'s `focus-visible:ring-*` chips untouched. The rule that makes safe: **opt out only by REPLACING it** — an `outline-none` with nothing behind it is the defect this fixed.
- **It's an explicit element list, not a bare `:focus-visible` — and the reason is the `tabindex="-1"` containers, not `<body>`.** Kit focuses `<body>` after a client-side navigation, which looks like the risk; measured, Chromium matches neither `:focus-visible` nor `:focus` on it, so that one is a non-issue. The real ones are the contact and login dialog panels (`div[tabindex="-1"].glass-card`): programmatically focusable, so a bare selector would ring the entire frosted panel the moment the dialog library focused its content instead of the close button — where Zag puts focus today, an implementation detail rather than a promise.
- **A global rule has no call sites, so only a browser can prove it fires.** `src/routes/focus-visible.e2e.ts` walks `/`, `/evidence` and `/login` with real **Tab** presses (`:focus-visible` is a heuristic under `element.focus()`) and asserts a **minimum stop count**, so a walk that finds nothing fails instead of passing. Links and buttons are held to the exact ring, compared against a probe element resolving the same `var()` — not a literal, because how a browser serializes `oklch()` in a computed style is its business. Fields, which legitimately opt out, are held to the weaker but still real claim that they **look different focused than unfocused** — that is what turns "opt out only by replacing it" from a documented convention into a tested one. Watch the appearance string it compares: `outline: none` does **not** reset `outline-offset`, so the base rule's `2px` survives on the computed style and a naive comparison reports a change that renders nothing (a deliberately-broken field passed the first version of the check for exactly that reason).
- **Tailwind v4's `transition-colors` includes `outline-color`**, and most links here carry it — so the ring does not appear at its final colour, it interpolates there from `currentColor` over 150ms. Harmless to look at (a 2px solid ring is fully drawn from the first frame; only its hue settles) but it will lie to anything that reads the computed style right after focusing, which is why the walk waits for each stop's transitions to finish first.

Two things about verifying this by eye, both learned the slow way: a `pnpm preview` serves the **last build**, so `pnpm build` first or you are looking at whatever the previous command compiled; and a browser extension in the **`data-darkreader-*` family rewrites colours in the page**, which makes every colour reading in that profile fiction. Playwright's chromium runs a clean profile and is the authority on colour; a normal browser is for geometry, clipping and decoration.

The corollary for new code: an interactive element needs **no** focus markup — it already has the ring. Reach for `hover-focus:` (never bare `hover:`) whenever the treatment's job is to say "this is interactive".

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
- **`.charge-flow` (clipped gradient text on "prove" / "Technologies") is the one exception to `-500`.** Over the translucent glass, the `-500` rose stop and the R→B blend dip to ~3.3:1 — marginal on the 20px header (issue #21). It uses the brighter **`-300`** steps of the same theme hues (local `--flow-r/b/g` aliases) so every point of the animated cycle clears ~5:1 (AA with margin under the blurred backdrop) — still the theme ramp, no re-typed hexes. The shimmer loops continuously but **stepped** (`steps(49)` ≈ 7 repaints/s, DAR-50): gradient text can only animate via its background — paint, never the compositor — so stepping is what caps its always-on repaint cost; `prefers-reduced-motion` drops it to a static gradient (one consolidated reduced-motion block at the foot of `layout.css` covers `.charge-flow` and `.glass-nav`).

### Glass surfaces — the shared `glass` base + variants

A shared **`@utility glass`** base in `layout.css` holds the frosted-glass invariants — a translucent 1px border, a faint white fill, the `--grain` film-over-top-sheen texture, and `backdrop-filter: blur` over the cosmic canvas. Every **raised** surface `@apply`s it and overrides only its own deltas: **`glass-panel`** (sections, readout bar — a hair less fill, stronger blur, a faint R→G→B charge tint, and a colour-charge lift shadow sized for large panes), **`glass-nav`** (the sticky header), **`glass-btn`** (CTAs), and **`glass-card`** (`@apply rounded-2xl glass-panel` — a `glass-panel` is _always_ a rounded card, so the two are bundled; add only per-site padding/width). Two more serve the contact form (see [contact](contact.md)) and are **not** built on the base (so the sheen skips them): **`glass-field`** is the _inverse_ — form inputs carved **into** the glass via inset (rather than lift) shadows (darker fill + grain, dark top-inner depth shadow + light bottom-inner bevel, primary/error focus rings); **`glass-menu`** is a floating dropdown/popover surface — like `glass-panel` but with a **more opaque** dark base, because it floats over busy content (form fields) rather than the void, so `glass-panel`'s ~4% fill would let text bleed through. It keeps the grain + sheen + heavy blur + lift so it still reads as frosted glass while staying legible.

**The `@apply`/token trap (issue #108).** A Tailwind v4 `@utility` that `@apply`s another _inlines_ its styles but **never adds the applied utility's class name to the element**: an element authored `class="glass-card"` gets all of `glass-panel`'s properties yet carries only the `glass-card` token. So `document.querySelectorAll('.glass-panel')` matches **nothing** when every panel is a `glass-card` — which is exactly what silently killed the sheen (panels never lit → the modal-button ghost). The convention now: the sheen selects **structurally**, never by an enumerated class list — `[class*="glass-"]:not(.glass-field):not(.glass-menu)` (`glass-sheen.ts`) — so any variant built on the base is lit automatically and the list can't drift as variants are added. **Caveat:** that's a _substring_ match, so a future token merely _containing_ `glass-` (e.g. `glass-divider`) would be swept in unintentionally — name raised surfaces so the match stays correct, or extend the `:not(...)` guard to exclude a non-raised one.

`glass-panel` and `glass-btn` also carry a faint R→G→B charge tint and a colour-charge drop shadow, sized for large panes. **`glass-nav` deliberately drops both.** The panel's 84px black halo + spread R/G/B glow were tuned for the hero panes; on the thin sticky bar they smeared over the page and floated as you scrolled (issue #20). The nav keeps only the frosted blur, grain, and top sheen over a thin border — so reach for `glass-nav`, not `glass-panel`, on any slim always-visible chrome.

`glass-nav`'s drop shadow is **shadow-on-scroll**: it's flat at the top of the page (the bar sits over the hero, nothing to lift off) and fades in a tight, neutral shadow once the header detaches from the top. `Header.svelte` toggles `data-stuck` on the `<nav>` via an `IntersectionObserver` watching a 0-height sentinel pinned at document top — so there is **no per-scroll handler**, only a fire as the header crosses the top edge (`.glass-nav[data-stuck='true']` carries the lifted shadow; the transition respects `prefers-reduced-motion`).

#### The nav row's breakpoint is measured (DAR-213)

The bar is `max-w-5xl` inside a padded header, so the row's usable width is `min(viewport − 64, 992)` — **capped**, however wide the screen. Against that: the brand lockup wants 498px on one line, the five anonymous nav items want 451px once they may not break mid-phrase, and 24px separates them — 973 against a ceiling of 992.

That margin is recent, and it is DAR-214's (below). It was **1050** against the same 992 while the row carried a sixth item, so the row did not fit on the terms it was written for at any width whatsoever; what it did instead was shrink both flex children, which is why the lockup rendered **stacked** at every desktop width and why the last two items used to break after their first word.

Squeezing is how the bar absorbs that deficit, and **three distinct things break as it does, in this order** — which is the part worth carrying to any other flex row:

1. the lockup is squeezed under its own contents and its text **escapes its box** (DAR-213 read this as Chromium refusing to stop at the minimum; DAR-229 measured it and the minimum itself was wrong — see below);
2. that escaped text **reaches the row** and renders on top of the links;
3. the bar's content finally **exceeds the bar** and spills outside the glass panel.

A check that watches only (3) — the obvious one — reports a layout as sound for another 80px of squeeze. That is not hypothetical: it is what made the ticket's arithmetic, and the first cut of the test, agree that the row "fits" at 870px, where the lockup is 80px outside its box and lying across the nav by 56px.

Three rules follow, and each was a defect before it was a rule:

1. **A desktop nav item is `whitespace-nowrap`; a menu item is not.** The row is horizontal and the flex algorithm will squeeze it, so a break there lands mid-phrase — never what a nav label means. The collapsed menu is a vertical stack of full-width blocks, where wrapping is the correct rendering and nowrap would push a long label out of the panel instead.
2. **The tier that reveals the row is derived from a measurement, not chosen.** Everything clears at **873px** today and cleared at **951px** when the tier was picked. `md:` (768) is under both, so `lg:` stands either way — but the derivation is worth keeping, because it is what a re-measure has to redo rather than re-read: at 951, the ~880 that looked like it fitted did not (nothing wrapped and nothing overflowed there, and the lockup lay across the nav by 46.5px), 960 cleared by 9px and left **2px per label** to grow, and `lg:` left **13px per label** — the first standard tier with margin in both directions. With five items it leaves 31.
3. **The tier is four class sites and they move together** — the row, its gap, the toggle, and the menu. Leaving one behind gives a band with no nav control at all.

`header-nav.e2e.ts` holds all three, plus the one they create: from 640 to 1023 the menu is now the _only_ nav, so it is asserted to carry every item. It asserts all three failure modes, and its headroom test is what rejects a tier that merely fits — "the row fits" and "the row fits with room to spare" are different claims, and only the second is a reason to have picked this tier.

Nothing here is visible in a class attribute: every input is a rendered measurement — the metrics of a self-hosted variable font, how flex distributes the shrink, which media query is live. **Re-measure after touching the labels, the lockup or the bar's cap; do not re-derive from the numbers above.**

#### Two of those three modes are unreachable now, and the mark is why (DAR-229)

The candidate fix was `min-width: min-content` on the lockup link, and it is a **no-op** — byte-identical at 13 widths, with all three thresholds unmoved. A flex item's `min-width` already computes to `auto`, which resolves to that same content-based minimum, so the clamp sets the property to the value it already had. The mechanism is one level down: **the mark is a replaced element and contributes nothing to that minimum**, so the link's minimum measured **252.5px** against contents needing **332.5** (mark 80 + gap 10 + "Technologies" 242.5) — the box really did stop at its minimum, and the minimum was smaller than the box's own contents.

`shrink-0` on the mark puts it back into that minimum. It lives in `Wordmark.svelte` rather than in the header's `markClass` because it is the mark's property and not one lockup's — and it is byte-identical in the footer at 280–1280px, so stating it once costs that call site nothing. Measured at `lg:`: escape and collision never fire through +90px per label, and the bar overflows at **+13**, exactly where the escape used to begin. **The fix does not move the point at which the row runs out of room — it changes which failure that point produces.** That is the shape worth carrying: a squeezed flex row finds something to give way silently, so make the silent thing rigid and the loud failure is all that is left.

It also surfaced what the silence had been hiding. Below **347px** the wordmark rendered outside its link box, and below ~327px on top of the menu toggle — live, and uncovered, because the spec's narrowest width was 390. The lockup was responsive on one axis only: the type steps at `sm:` and the mark did not, so a phone got an 80px mark beside 20px type — 4:1 against desktop's 2.2:1, a quarter of a 320px viewport. The mark now steps with the type (`size-14 sm:size-20`) and the bar's gap with it (`gap-3 sm:gap-6`), taking the header's floor from 347px to **311** — clear of 320, which is both WCAG 1.4.10's reflow width and where a 390px phone lands at 125% browser zoom. Floors measured with the mark held: 80px survives to 347, 64px to 331, 56px to 323, and 56px with the tightened gap to 311. DAR-213's tier is untouched either way (950 against 951), which is why this was separable from it.

Two things about the test. The `320px` row is the fit's only guard. And the over-squeeze test (**+38px** per label — inside the band where the old code failed silently, between escape at +31 and overflow at +47, so it is the one squeeze that tells the two designs apart) is the only place in the repo that asserts a **broken** bar on purpose: its overflow assertion is a positive control, because every other assertion in it is "nothing moved" — which is exactly what a broken instrument reports too. That control covers the headroom test as well, since both drive the same padding injection and the injection breaking leaves the headroom test green.

**The control runs last, and the order is load-bearing.** Inside that band an unpinned mark absorbs the squeeze, so the bar does _not_ overflow — the lockup gives way instead, which is the whole reason the band exists. Assert the control first and undoing `shrink-0` fails on it, reporting "something got wider" about a header where nothing did: the right test, red for the wrong reason, pointing at the wrong file. Ordered the other way each defect reaches the assertion written for it — an unpinned mark hits the escape check, a dead injection hits the control.

Those three numbers were **+20 / +13 / +26** when the row carried six items. Every threshold in that file is per LABEL, so dropping one spreads the same deficit across fewer of them and all of them rise together — **re-measure them, never rescale them**.

#### The row got its margin back, and the lockup with it (DAR-214)

Dropping "Sign in" from the nav was a product decision (see [auth](auth.md)) with a layout consequence, measured rather than predicted:

| measured                             | six items        | five            |
| ------------------------------------ | ---------------- | --------------- |
| the anonymous row clears from        | 951px            | **873px**       |
| the bar overflows at `lg:`           | +13px per label  | **+31px**       |
| the brand lockup renders on one line | never, any width | **from 1039px** |

The last row is the visible one, and it retires a claim DAR-213 made here: the stacked lockup was load-bearing rather than decorative, because 498 + 24 + 528 exceeded the 992 cap and one line beside **that** nav was impossible at any width whatsoever. 498 + 24 + 451 does not exceed it, so the wordmark reads on one line from 1039px up and still stacks between the tier and there. Nothing asserts it: whether the nav carries five items or six is a product question, and a test pinning the one-line lockup would quietly answer it from the layout side.

**The binding case moved out of e2e's reach.** The anonymous row was the widest at 951 against the signed-in row's 893; it is now the narrowest — anonymous **873**, signed-in staff **892**, signed-in end-user **907**, "Account" being a wider label than "Admin". e2e has no session, so the row it measures is no longer the one that binds. All three clear `lg:` by more than 100px, which is what makes that a note rather than a problem — but a later item narrows the gap for a row no test here can see.

### Page hero — glass panel over the helix (the standard for every page)

Every page's hero uses **one** pattern: an `eyebrow-hero` kicker, then an empty **`#helix-slot`** gap where `CosmicBackdrop` centres **and sizes** the twisting RGB helix (it measures that element — absent, the helix falls back to a default mid-canvas spot, and its height caps the amplitude, so shrinking the slot shrinks the helix), then the heading + lede inside a **`glass-card`**. The `-mt-10` on the section cancels `<main>`'s `py-10` so the helix rises under the header.

Where the panel sits is the one thing that differs, and it splits two ways:

- **The homepage** keeps the panel fully **below** the helix — there the helix is the centrepiece. It composes its own hero for exactly this reason.
- **Every other page** uses the shared **`PageHero`** component (`/news` · `/research` · `/people` and their detail pages, `/privacy` · `/terms`, `/about`), which pulls the panel **up** by `--helix-pull` so the helix becomes a backdrop behind and beside the frosted panel, its wider outer arcs peeking out at the sides.

Both geometry values are `:root` tokens in `layout.css` (`--helix-slot-h`, `--helix-pull`), pinned by `styles.spec.ts` — never re-typed at a call site.

New pages reuse `PageHero` — never a bare centered heading with no panel/helix.

**Utility pages are a different family.** `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/updates/*`, `/contact` and `/waitlist` have no hero at all: they are a single card centred in the viewport, and that shell is the **`UtilityPanel`** component (DAR-222), which takes a `width` (`sm` by default, `lg` for a panel holding a real form) and an optional `below` slot for content that must sit inside the centred section but outside the card.

> Note: `glass-panel` exists as a `@utility` but **no markup uses it** — every raised surface on the site is `glass-card`, `glass-nav`, `glass-btn`, `glass-field` or `glass-menu`. Two source comments still named it and were corrected in DAR-222; the utility itself is left in place, since the sheen selects `glass-*` structurally and removing it is a separate decision.

### Glass sheen — one light source (`.sheen-plane`)

A soft diagonal highlight drifts across every frosted surface, like light glinting off glass. It's a single gradient band, `transform`-animated across the viewport and `clip-path`'d to the **union of the glass rects** — so every panel/nav/button shows the same beam at its true screen position (one coherent light source, not per-panel glints). The clip (rounded rects, radius read from each element's `border-radius`) is maintained in JS (`src/lib/glass-sheen.ts`); `pointer-events: none` + the clip mean it only draws on glass. While the contact modal is open the clip switches to the modal's glass only, so page panels behind the scrim don't bleed sheen over it.

**It is TWO planes, and the clip is never rewritten on scroll (DAR-170).** It used to be one `position: fixed` overlay whose `clip-path` was rebuilt from every glass rect on each scroll frame. On mobile that ghosted: scroll runs on the compositor thread and scroll events are delivered asynchronously and coalesced, so the clip described where the glass **was** — hard-edged windows lagging against crisp glass borders, worse the faster the scroll, on every page. The clip now lives in coordinate spaces that don't change with scroll, one per anchoring regime:

- **`[data-sheen-plane="page"]`** — `position: absolute`, in the document's scroll flow, at **`z-30`**. The _browser_ moves it and its **page-coordinate** clip in step with the panels, so they can't drift however far behind the main thread falls. `height: 0` on purpose: an absolutely positioned element contributes to scrollable overflow, so sizing it to the document would grow the document and then the next measurement — and clip coordinates aren't limited to the border box, so zero height clips correctly anyway.
- **`[data-sheen-plane="viewport"]`** — `position: fixed` at **`z-70`**, above the scrim/header/modal so it still lights them. Holds sticky/fixed glass, whose viewport rects don't move with scroll. Anchoring is decided **structurally** — an ancestor walk for `position: fixed | sticky` — not from a list of known components, for the same reason the glass set itself is matched structurally.

Both clips rebuild only on reflow, resize, navigation and modal toggles. Four rules fall out, and each one is a way to silently reintroduce the bug:

1. **`clip-path` travels WITH an element's transform.** The first attempted fix kept the plane fixed and moved a clip layer by `translate3d(0, -scrollY)` from a scroll handler; the clip went on lagging and only the property carrying it changed. A JS-written transform does **not** get a lagging clip off the scroll path.
2. **Never add `transform`, `filter`, `contain` or `will-change` to a plane or any ancestor.** The beams are `position: fixed`, which is the only reason they stay screen-anchored with zero JS — and `clip-path` does **not** create a containing block for a fixed descendant, while all four of those **do** (measured: a fixed child stayed at viewport `y=0` under `clip-path`, and was dragged to −1000 under each of the others). Adding one would make the beams scroll away with the page.
3. **Neither plane may take `overflow: hidden`** — it would clip the fixed beams to the plane's own box, which is nothing at all for the zero-height one.
4. **The page plane must stay below the scrim.** At `z-70` it lit a rectangle over content the scrim exists to dissolve: a panel scrolled _under_ the nav still has a clip window there, so its sheen painted over the nav band and page content showed through faintly.

**"Viewport-anchored" means two different things on mobile.** The sticky nav is anchored to the **layout** viewport, but a hard scroll to the top expands the URL bar, which moves the **visual** viewport underneath it — the nav rides that and a static clip doesn't, so its sheen slid, ghosted and snapped back. `visualViewport`'s `resize`/`scroll` events report exactly that movement and rebuild the **viewport plane only** (one or two small rects, rAF-batched, for the duration of that animation). The page plane is never rewritten during it.

**None of this is testable in CI.** Playwright's mobile emulation changes viewport, DPR and UA — not the compositor or scroll-event delivery — so an emulated run cannot reproduce or refute any of it. The bisect that found the cause ran on a real device through a temporary `?glassdiag=` harness, one arm per suspect, every arm in both motion modes; verified afterwards on Chrome Android, the Google app WebView and iOS Safari.

**Never put a `glass-*` surface inside a collapsed container (DAR-56).** The clip is built from each glass element's `getBoundingClientRect()`, and a **closed `<details>` does not zero that rect** — it hides its body with `content-visibility: hidden`, which skips painting and the a11y tree but still reports full geometry when measured. A `glass-card` on the `<dl>` inside /research's topic-guide disclosure therefore reported a **768×689 box while invisible**, and the sheen dutifully cut a window that size straight over the paper cards below it. The fix is structural, not a special case in `glass-sheen.ts`: the card wraps the **whole** `<details>`, so the lit surface is always the visible one and opening it merely **grows** a panel — the case the sizeObserver already handles (verified: every clipped window maps to a `checkVisibility()`-true element in both states). `TopicGuide.svelte.spec.ts` asserts no `[class*="glass-"]` exists inside the `<details>`, because this is a rule that reads like taste until it costs someone an afternoon.

**Perf:** the beam is `transform`-only, so it's **compositor-only** — it never repaints the panels or re-runs their `backdrop-filter` blur (measured: steady-state Paint Δ ≈ 0; scrolling flat at baseline). Since DAR-170 **nothing runs per scroll frame at all** — no listener, no geometry read, no style write; the browser scrolls the page plane natively. The `getBoundingClientRect` pass happens only on reflow/resize/navigation/modal-toggle, plus a debounced re-clip after a scroll settles (insurance, so a layout shift the observers miss self-corrects without putting work back on the hot path). Frozen under `prefers-reduced-motion`. Lesson: animate glass reflections as a **transform on a separate overlay**, never as a filter/`background-position` on the blurred element itself — the latter re-runs the blur every frame (see the [CosmicBackdrop note above](#dark-mode) for the same trap).

**Contrast-safe text rules (WCAG AA).** These panels sit on the near-black void with a heavy blur, and the faint R→G→B charge tint _lightens_ patches of the pane — which **lowers** contrast for white text. Foreground text is **pure white at graded opacity** (a deliberate, consistent hierarchy — not token drift), floored so even the lightened patches clear AA (4.5:1 for normal-size body and labels):

- `text-white` — headings and primary readout values.
- `text-white/70` — **body-copy floor** (hero lede, pillar/domain/section copy). The old `/55`–`/50` computed ~4.4:1 _at best_ and less over tinted patches — under AA (issue #16).
- `text-white/60` at **≥ 12px** (`text-xs`) — mono kickers, tracked labels, readout captions. The old `/40`–`/35`, some at 11px, were well under AA.
- **`< white/50` is decoration only** — borders, dividers, hover fills (`border-white/10`, `divide-white/10`, `hover:bg-white/10`). Never body text or labels.

Keep body text at **≥ 70%** and labels at **≥ 60% / 12px**; below those, white-on-glass drops under AA over the tinted patches. Accent (non-white) text uses the triad via `.charge-flow` (itself floored to the brighter `-300` steps for the same reason — see the triad section). When a surface is _not_ glass-over-void (e.g. a future light section), use Skeleton's `text-surface-*` contrast tokens instead of white-at-opacity.
