# Commands

- `pnpm dev` — Vite dev server.
- `pnpm build` — regenerates types (`scripts/gen-types.mjs`) then `vite build`. Output goes to `.svelte-kit/cloudflare`.
- `pnpm preview` — serve the built worker through `wrangler dev` on [this checkout's port](#the-preview-port-dar-79), i.e. a real Workers runtime, not `vite preview`. Bakes Cloudflare's always-pass Turnstile **test** keys (`--var` in `scripts/preview.mjs`) so a widget mounts on localhost — a real sitekey rejects localhost. → [security-headers](security-headers.md)
- `pnpm check` — regenerates types + compiles Paraglide + `svelte-kit sync` + `svelte-check` (type/diagnostic check). The Paraglide compile makes it work on a **fresh clone** (the vite plugin only generates `src/lib/paraglide` during dev/build, and svelte-check needs it).
- `pnpm lint` — `prettier --check .` then `eslint .`. `pnpm format` writes Prettier fixes.
- `pnpm gen` — `scripts/gen-types.mjs`; regenerates `worker-configuration.d.ts` (the `Env` type consumed by `src/app.d.ts` and referenced in `tsconfig.json`). Run this after changing `wrangler.jsonc` bindings **or `.env.example`** — generation is **deterministic** (DAR-49): env-var _names_ come from the committed `.env.example` (never your real `.env`), and the volatile bits of wrangler's output (content hash, the build-output-dependent `GlobalProps` block) are normalized away, so any checkout — including CI, which has no `.env` — reproduces the committed file byte-for-byte. Never run `wrangler types` directly. Corollary: **a new runtime env var isn't typed until it's listed in `.env.example`** (which [deployment](deployment.md) already requires). The `check` CI job drift-guards the committed copy, so a `wrangler.jsonc`/`.env.example`/wrangler-version change must ship its regenerated types.
- `pnpm storybook` — Storybook dev server on 6006. `pnpm build-storybook` for static build.

## The preview port (DAR-79)

`pnpm preview` and Playwright's `webServer` share one derived port. It is written down in exactly one
place — [`scripts/preview-port.mjs`](../scripts/preview-port.mjs) — and nowhere else:

- **main checkout → 4173**, so every `curl localhost:4173` in these docs and CI's `ORIGIN` stay true
- **each linked worktree → its own stable slot, 4174–4272**, hashed from the worktree's path (stable
  across branch switches, because it is the path that is hashed)
- `PREVIEW_PORT=4200 pnpm preview` overrides both, and a value that isn't a port is **refused**, not
  quietly ignored

Why it's derived: `reuseExistingServer` defaults **on** locally, so while every checkout previewed on
4173, a preview left running in a sibling worktree was silently reused — a green suite describing
someone else's branch. That default is now off; a busy port stops the run. `E2E_REUSE_SERVER=1` opts
back in for the iterate-on-specs loop (keep a fresh preview up, skip the ~60 s rebuild) and warns that
the results describe whatever is already listening.

**Something already on the port?** Both the preview script and the Playwright config print the owner —
pid, working directory, and the pid to `kill`. Read that before killing anything:

- The cwd says whose it is. **Another checkout means another session** — use `PREVIEW_PORT`, don't
  kill it.
- Never `pkill -f workerd` / `pkill -f wrangler`: it sweeps every worktree's server at once. The
  reflex one-liner is worse — `ss -ltnp | grep -oP '(?<=pid=)\d+' | head -1` returns the first
  listening socket on the box, not the one on your port. (It once killed an unrelated process here.)
- Kill the **tree root**, not the socket owner. `workerd` is wrangler's grandchild; killing it alone
  just makes wrangler respawn one. A SIGTERM anywhere in the tree reaps the whole thing.
- A tree whose parent was SIGKILLed keeps the port forever under `ppid 1` — that is where stale
  servers come from. `pnpm preview` now reaps its own tree on SIGTERM/SIGINT, so a plain `kill` is
  enough.

## Tests

- `pnpm test:unit` — Vitest (watch). `pnpm test:unit --run` for a single pass. Filter with a path/name, e.g. `pnpm test:unit --run src/lib/vitest-examples/greet.spec.ts`.
  - **No `--` before the flags.** pnpm forwards a literal `--` and the **filter is silently dropped**: `pnpm test:unit -- --run scripts/vitest-failure-report` runs the whole suite (52 files / 659 tests) instead of the one file (15), while still looking like it worked. `--run` survives, the path doesn't — so you wait out the full suite and read a green result for tests you didn't mean to run. This is the same trap [test.yml](../.github/workflows/test.yml) calls out for the CI invocation.
- `pnpm test:e2e` — installs chromium (the only browser the config ever launches), then Playwright. Playwright's `webServer` runs `pnpm build && pnpm preview` on [this checkout's port](#the-preview-port-dar-79), so e2e exercises the Cloudflare preview build — and never an already-running server. Test files match `**/*.e2e.{ts,js}`.
  - **Local re-run gotcha:** `wrangler dev` persists the worker's Cache API to `.wrangler/state` (gitignored — CI's clean checkout is immune), and the adapter caches any `Cache-Control: public` response. `/sitemap.xml` ships `max-age=3600`, so a rebuilt preview within the hour can replay the _previous build's_ cached sitemap and fail the seo specs against changes that are really there — `rm -rf .wrangler/state` and re-run.
- `pnpm test` — unit (`--run`) then e2e.

Vitest is configured with **three projects** (see `vite.config.ts`), so pick the right filename convention:

- `client` — browser (Playwright/chromium), matches `src/**/*.svelte.{test,spec}.{js,ts}`. Use for component tests.
- `server` — node env, matches `src/**/*.{test,spec}.{js,ts}` excluding the `.svelte.` ones.
- `storybook` — runs stories as tests via `@storybook/addon-vitest`.

Note: `test.expect.requireAssertions` is on — every test must make at least one assertion.

### When a unit run goes red (DAR-90)

**You don't have to keep the log.** Every red run writes itself to `test-failures/<ISO>-<pid>.json`
(gitignored, newest 50 kept, uploaded as a CI artifact on a failed unit job) — each failed test's
name, `file:line`, project, duration vs its timeout, whether it was a **timeout**, and the error;
plus module collection errors, unhandled errors, the machine's load, and the **10 slowest tests of
that run**.

That last part is the one to read first on a one-off failure. Compare it against a known baseline:
the suite's slowest test (`GlassSelect`) has measured 914 ms and 2346 ms on the same machine —
**2.6× run-to-run variance** — so a report showing it at several times that says the box was
overloaded, and one showing it under a second rules load out. That is the question a
red-once-green-since failure always raises, and `loadavg` alone can't answer it.

Names are unique per run and green runs write nothing, so re-running never destroys the previous
record — the defect that created DAR-90, where a suite was piped through `grep` and immediately
re-run, leaving a failure count with no name attached.

**One trap:** `--reporter=<name>` on the command line **replaces** the configured reporters rather
than adding to them, so `pnpm test:unit --run --reporter=verbose` records nothing — and that is the
flag you reach for while chasing a flake, the one moment the record matters most. Adding
`--reporter=default` does _not_ bring it back (it's still a CLI list). Name the recorder itself:

```sh
pnpm test:unit --run --reporter=verbose --reporter=./scripts/vitest-failure-report.ts
```

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
