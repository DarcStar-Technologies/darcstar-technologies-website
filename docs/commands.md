# Commands

- `pnpm dev` — Vite dev server.
- `pnpm build` — runs `wrangler types --check` then `vite build`. Output goes to `.svelte-kit/cloudflare`.
- `pnpm preview` — serve the built worker through `wrangler dev` (port 4173), i.e. a real Workers runtime, not `vite preview`. Bakes Cloudflare's always-pass Turnstile **test** keys (`--var` in package.json) so the signup widget mounts on localhost — a real sitekey rejects localhost. → [security-headers](security-headers.md)
- `pnpm check` — `wrangler types --check` + `svelte-kit sync` + `svelte-check` (type/diagnostic check).
- `pnpm lint` — `prettier --check .` then `eslint .`. `pnpm format` writes Prettier fixes.
- `pnpm gen` — `wrangler types`; regenerates `worker-configuration.d.ts` (the `Env` type consumed by `src/app.d.ts` and referenced in `tsconfig.json`). Run this after changing `wrangler.jsonc` bindings.
- `pnpm storybook` — Storybook dev server on 6006. `pnpm build-storybook` for static build.

## Tests

- `pnpm test:unit` — Vitest (watch). `pnpm test:unit -- --run` for a single pass. Filter with a path/name, e.g. `pnpm test:unit -- --run src/lib/vitest-examples/greet.spec.ts`.
- `pnpm test:e2e` — installs browsers, then Playwright. Playwright's `webServer` runs `pnpm build && pnpm preview`, so e2e exercises the Cloudflare preview build. Test files match `**/*.e2e.{ts,js}`.
- `pnpm test` — unit (`--run`) then e2e.

Vitest is configured with **three projects** (see `vite.config.ts`), so pick the right filename convention:

- `client` — browser (Playwright/chromium), matches `src/**/*.svelte.{test,spec}.{js,ts}`. Use for component tests.
- `server` — node env, matches `src/**/*.{test,spec}.{js,ts}` excluding the `.svelte.` ones.
- `storybook` — runs stories as tests via `@storybook/addon-vitest`.

Note: `test.expect.requireAssertions` is on — every test must make at least one assertion.
