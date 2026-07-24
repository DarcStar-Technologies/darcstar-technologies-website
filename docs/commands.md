# Commands

- `pnpm dev` — Vite dev server.
- `pnpm build` — regenerates types (`scripts/gen-types.mjs`) then `vite build`. Output goes to `.svelte-kit/cloudflare`.
- `pnpm preview` — serve the built worker through `wrangler dev` (port 4173), i.e. a real Workers runtime, not `vite preview`. Bakes Cloudflare's always-pass Turnstile **test** keys (`--var` in package.json) so the signup widget mounts on localhost — a real sitekey rejects localhost. → [security-headers](security-headers.md)
- `pnpm check` — regenerates types + compiles Paraglide + `svelte-kit sync` + `svelte-check` (type/diagnostic check). The Paraglide compile makes it work on a **fresh clone** (the vite plugin only generates `src/lib/paraglide` during dev/build, and svelte-check needs it).
- `pnpm lint` — `prettier --check .` then `eslint .`. `pnpm format` writes Prettier fixes.
- `pnpm gen` — `scripts/gen-types.mjs`; regenerates `worker-configuration.d.ts` (the `Env` type consumed by `src/app.d.ts` and referenced in `tsconfig.json`). Run this after changing `wrangler.jsonc` bindings **or `.env.example`** — generation is **deterministic** (DAR-49): env-var _names_ come from the committed `.env.example` (never your real `.env`), and the volatile bits of wrangler's output (content hash, the build-output-dependent `GlobalProps` block) are normalized away, so any checkout — including CI, which has no `.env` — reproduces the committed file byte-for-byte. Never run `wrangler types` directly. Corollary: **a new runtime env var isn't typed until it's listed in `.env.example`** (which [deployment](deployment.md) already requires). The `check` CI job drift-guards the committed copy, so a `wrangler.jsonc`/`.env.example`/wrangler-version change must ship its regenerated types.
- `pnpm storybook` — Storybook dev server on 6006. `pnpm build-storybook` for static build.

## Tests

- `pnpm test:unit` — Vitest (watch). `pnpm test:unit -- --run` for a single pass. Filter with a path/name, e.g. `pnpm test:unit -- --run src/lib/vitest-examples/greet.spec.ts`.
- `pnpm test:e2e` — installs chromium (the only browser the config ever launches), then Playwright. Playwright's `webServer` runs `pnpm build && pnpm preview`, so e2e exercises the Cloudflare preview build. Test files match `**/*.e2e.{ts,js}`.
- `pnpm test` — unit (`--run`) then e2e.

Vitest is configured with **three projects** (see `vite.config.ts`), so pick the right filename convention:

- `client` — browser (Playwright/chromium), matches `src/**/*.svelte.{test,spec}.{js,ts}`. Use for component tests.
- `server` — node env, matches `src/**/*.{test,spec}.{js,ts}` excluding the `.svelte.` ones.
- `storybook` — runs stories as tests via `@storybook/addon-vitest`.

Note: `test.expect.requireAssertions` is on — every test must make at least one assertion.

Both suites are **hermetic** — no real credentials anywhere: CI runs the unit suite with no env
at all, and the e2e job against committed placeholder values (test.yml writes them; the worker
needs vars _present_ to construct its DB/auth clients, but the specs are written DB-free and
never query). A Sanity-token-less preview degrades to empty content lists, which the specs
tolerate. Keep new tests that way; anything needing real credentials belongs in
`pnpm smoke:signin`-style scripts, not the gated suites.

## CI (required checks)

Every PR must pass six required checks before merge to `main` (which triggers the production
deploy — see [deployment](deployment.md)):

- `lint` + `commitlint` ([lint.yml](../.github/workflows/lint.yml), commitlint.yml)
- `migrations in sync` ([drizzle.yml](../.github/workflows/drizzle.yml)) — drizzle/ trail matches the schema
- `check` ([check.yml](../.github/workflows/check.yml)) — `pnpm check` + a drift guard on the committed `worker-configuration.d.ts` (DAR-49)
- `unit tests` + `e2e` ([test.yml](../.github/workflows/test.yml)) — the three vitest projects, then Playwright against the built Cloudflare bundle (DAR-49)

`actionlint` also runs on workflow changes but isn't a required context.
