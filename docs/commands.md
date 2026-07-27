# Commands

- `pnpm dev` — Vite dev server.
- `pnpm build` — regenerates types (`scripts/gen-types.mjs`) then `vite build`. Output goes to `.svelte-kit/cloudflare`.
- `pnpm preview` — serve the built worker through `wrangler dev` on [this checkout's port](#the-preview-port-dar-79), i.e. a real Workers runtime, not `vite preview`. Bakes the env whose production values can't work against localhost ([`scripts/preview-vars.mjs`](#what-the-preview-overrides-dar-81)). → [security-headers](security-headers.md)
- `pnpm check` — regenerates types + compiles Paraglide + `svelte-kit sync` + `svelte-check` (type/diagnostic check). The Paraglide compile makes it work on a **fresh clone** (the vite plugin only generates `src/lib/paraglide` during dev/build, and svelte-check needs it).
- `pnpm lint` — `prettier --check .` then `eslint .`. `pnpm format` writes Prettier fixes.
- `pnpm gen` — `scripts/gen-types.mjs`; regenerates `worker-configuration.d.ts` (the `Env` type consumed by `src/app.d.ts` and referenced in `tsconfig.json`). Run this after changing `wrangler.jsonc` bindings **or `.env.example`** — generation is **deterministic** (DAR-49): env-var _names_ come from the committed `.env.example` (never your real `.env`), and the volatile bits of wrangler's output (content hash, the build-output-dependent `GlobalProps` block) are normalized away, so any checkout — including CI, which has no `.env` — reproduces the committed file byte-for-byte. Never run `wrangler types` directly. Corollary: **a new runtime env var isn't typed until it's listed in `.env.example`** (which [deployment](deployment.md) already requires). The `check` CI job drift-guards the committed copy, so a `wrangler.jsonc`/`.env.example`/wrangler-version change must ship its regenerated types.
- `pnpm storybook` — Storybook dev server on 6006. `pnpm build-storybook` for static build.

## The preview port (DAR-79)

`pnpm preview` and Playwright's `webServer` share one derived port. It is written down in exactly one
place — [`scripts/preview-port.mjs`](../scripts/preview-port.mjs) — and nowhere else:

- **main checkout → 4173**, so every `curl localhost:4173` in these docs stays true
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

## What the preview overrides (DAR-81)

`pnpm preview` bakes three things into its `wrangler dev` invocation, all derived in one place
([`scripts/preview-vars.mjs`](../scripts/preview-vars.mjs)) and all for the same reason — the
production value cannot work against localhost:

| Var                       | Value                              | Why                                                                                                                                                         |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURNSTILE_*`             | Cloudflare's always-pass test keys | A real sitekey rejects localhost, so no widget could mount (DAR-45).                                                                                        |
| `ORIGIN`                  | `http://localhost:<port>`          | Better Auth mounts `/api/auth` **only** for requests whose origin matches its baseURL, so the production value leaves the auth API not mounted at all.      |
| `AUTH_RATE_LIMIT_STORAGE` | `memory`                           | The limiter runs before every auth route and stores counters in the **database**; this suite has none, so every auth endpoint answered 500 — `GET /ok` too. |

They are `--var` flags rather than `.env` entries on purpose. A `--var` **beats** a `.env` entry, so
what the suite exercises no longer depends on what a developer happens to have in their `.env` — and
that was a live defect, not a hypothetical: CI hand-wrote `ORIGIN=http://localhost:4173` and so
reached the auth API, while a local run (whose `.env` holds the _dev server's_ origin, on a port a
worktree derives independently) silently tested a `/api/auth` that 404'd. Anything that must track
the port is now derived from it, so there is no second copy to drift.

wrangler takes the **last** `--var` for a repeated name and ours go first, so
`pnpm preview --var ORIGIN:https://darcstar.tech` is the escape hatch for previewing against a
production-shaped origin.

**Two consequences worth knowing.** The rate limiter is real in a preview, just in memory — a fresh
preview starts with empty counters, but `E2E_REUSE_SERVER=1` keeps them, so the 4th e2e run within
the hour trips the 3/hour sign-up cap and `auth-api.e2e.ts` fails; restart the preview. The same is
true of the smokes, whose per-hour caps are tighter (below): **restarting `pnpm preview` is how you
clear a bucket**, not waiting. And the hand-run smokes now reach `/api/auth/*` too, which is what
[`smoke-invite.ts`](../scripts/smoke-invite.ts) uses to follow the emailed activation link and to
probe the anti-enumerating endpoints (DAR-91).

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
tolerate. Keep new tests that way; anything needing real credentials belongs in a **manual smoke**
(below), not the gated suites.

### Manual smokes (not in CI)

Two scripts drive the real endpoints of a built preview over HTTP, no browser. Both are **run by
hand** — they need real credentials and write to the dev database — and both exit non-zero on the
first failed assertion. Start `pnpm build && pnpm preview` in one shell, then in another:

- `pnpm smoke:signin` (`scripts/smoke-signin.mjs`, #69) — sign-in → `/admin` → the navbar's auth
  states → the full operator-roster lifecycle (create → non-admin guard → reset → force-logout →
  disable → enable → delete) → `/logout` → the guard. Needs `ADMIN_EMAIL`/`ADMIN_PASSWORD` for a
  provisioned account (`pnpm admin:create`).
- `pnpm smoke:invite` (`scripts/smoke-invite.ts`, DAR-80 + DAR-91) — the invite → activation
  lifecycle that the hermetic suites structurally cannot reach, now including the emailed link's
  own GET callback and an anti-enumeration probe (below). Same credentials, plus `DATABASE_*` and a
  real `RESEND_API_KEY` in `.env`, since it asserts against the database and really sends. Mail goes
  to `delivered@resend.dev` (Resend's test recipient — a real send, visible in the Resend logs, in
  nobody's inbox); `SMOKE_INVITE_EMAIL` overrides it, so point it only at a mailbox you own — and
  note a run sends that address **two** emails since DAR-91, the invitation and a real password
  reset the anti-enumeration probe cannot ask its question without triggering. See
  [auth](auth.md#invite-only-onboarding-dar-67).

**A run spends two of the 3/hour `/request-password-reset` budget** (the probe asks about an account
and about a stranger), so a second run inside the hour fails there rather than at anything real. The
failure names itself and the fix — restart `pnpm preview`, which clears the in-memory counters. That
probe is deliberately ordered **status first, bodies second**: two 429s are byte-identical, so
comparing bodies alone reports "identical, no leak" about an endpoint that answered nothing —
DAR-81's failure mode with the polarity flipped.

`SMOKE_BASE` overrides the target for both; the default follows [this checkout's preview
port](#the-preview-port-dar-79). Shared HTTP plumbing lives in `scripts/smoke-http.mjs`, including
one behaviour worth knowing: Better Auth caps `/sign-in/email` at **3 per short window**, and each
script spends two sign-ins, so running two back to back trips it on the fourth. A 429 is waited out
**once**, loudly (`… sign-in rate-limited; waiting 15s`); a second one is reported as a failure,
because by then something other than your own cadence is holding the bucket down. Note the
asymmetry in what checks them: `vite.config.ts`'s `kit.typescript.config` hook pushes
`../scripts/**/*.ts` into the generated `include` (DAR-79), so `pnpm check` type-checks
`smoke-invite.ts` against the real drizzle schema on every PR — mutating a column type in it really
does turn the `check` job red. The `.mjs` scripts get no such guard (`checkJs` is off and they aren't
in `include` at all), which is a reason to reach for `.ts` (run under `tsx`, as `admin:create` does)
in a new one.

## CI (required checks)

Every PR must pass six required checks before merge to `main` (which triggers the production
deploy — see [deployment](deployment.md)):

- `lint` + `commitlint` ([lint.yml](../.github/workflows/lint.yml), commitlint.yml)
- `migrations in sync` ([drizzle.yml](../.github/workflows/drizzle.yml)) — drizzle/ trail matches the schema
- `check` ([check.yml](../.github/workflows/check.yml)) — `pnpm check` + a drift guard on the committed `worker-configuration.d.ts` (DAR-49)
- `unit tests` + `e2e` ([test.yml](../.github/workflows/test.yml)) — the three vitest projects, then Playwright against the built Cloudflare bundle (DAR-49)

`actionlint` also runs on workflow changes but isn't a required context.
