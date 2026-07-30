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

## The database the e2e suite runs against (DAR-85)

Two more `--var`s (`DATABASE_URL` + `DATABASE_AUTH_TOKEN`) are baked on top of the four above, and
they belong to the **test harness rather than to `pnpm preview`** —
[`playwright.config.ts`](../playwright.config.ts) appends `hermeticDbVarArgs()` to the webServer
command, so `DATABASE_URL` becomes `libsql://127.0.0.1:1` for the suite and for nothing else:

| Where                      | Database                                    |
| -------------------------- | ------------------------------------------- |
| `pnpm test:e2e`            | `libsql://127.0.0.1:1` — refused at connect |
| `pnpm preview` (by itself) | whatever `.env` names                       |
| `pnpm smoke:*`             | whatever `.env` names (they assert on rows) |

**That split is load-bearing, and folding it into `previewVars` is the mistake to avoid.**
`smoke:invite` and `smoke:waitlist` are hand-run against a preview and assert on rows in the `.env`
database — they are the only coverage the invite path and the composed waitlist flow have — so a
dead DB in `previewVars` would break every run of both, and their own diagnostic ("is the preview
pointed at a different database than `.env`?") would send the reader after an `.env` that is fine. A
spec pins the separation in both directions.

**Why the suite needed its own value.** The CI workflow hand-wrote `DATABASE_URL=libsql://placeholder.invalid`
into a `.env`, so **only CI was hermetic**: a local run used the developer's real dev database, which
is DAR-81's defect one var over — one suite testing two different things, with the local half writing
to shared data. Measured on the dev DB when this was found: 5,118 `waitlist_funnel_event` rows
against **0** leads and 0 submissions, i.e. `/admin/waitlist`'s conversion readout computed entirely
over automated traffic.

**Why an IP and not a hostname.** An unresolvable _host_ is what made a CI e2e log unreadable: workerd
logs every failed DNS lookup itself, raises a `jsgInternalError` with a full native stack per attempt,
and leaves one rejection per query unobserved — `Uncaught Error: internal error; reference = …`, which
is indistinguishable from a real fault. Measured over four DB-touching requests:

| `DATABASE_URL`                 | DNS-fail lines | `Uncaught` | workerd internal | our own logs | `/sign-up` | `/forgot-password` |
| ------------------------------ | -------------- | ---------- | ---------------- | ------------ | ---------- | ------------------ |
| `libsql://placeholder.invalid` | 9              | 3          | 9                | 2            | 400        | 200                |
| `libsql://127.0.0.1:1`         | **0**          | **0**      | **0**            | 2            | 400        | 200                |
| _absent_                       | 0              | 0          | 0                | 0            | **500**    | **500**            |

**The absent row is the trap.** `getDb()` throws when either var is missing and `authOptions` calls it
eagerly (`drizzleAdapter(getDb(), …)`), so `getAuth()` throws and every auth route answers 500 —
including DAR-67's sign-up boundary, whose `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` becomes a 500 that
`expect(res.ok()).toBe(false)` still passes. That is DAR-81's two-gates-failing-closed-into-a-pass,
reinstated. So the requirement is **constructible but unreachable**: the client must build and only
the query may fail. `libsql://` (not `http://`) keeps the production scheme; port 1 needs root to
bind, so nothing can answer it by accident.

What remains in the log is our own labelled output — `waitlist funnel capture failed …`, Better
Auth's error line — which is honest and greppable. Don't silence those: the point was to remove the
lines nobody could attribute, not the ones that say which code path noticed.

**`E2E_REUSE_SERVER=1` opts out of this too**, since the override lives in the command Playwright
would otherwise run: a hand-started `pnpm preview` serves the specs from your `.env` database. The
warning the config prints says so.

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
at all, and the e2e suite against placeholder values. The worker needs vars _present_ to construct
its DB/auth clients, but the specs are written DB-free and never query; the database placeholder is
[derived by the harness](#the-database-the-e2e-suite-runs-against-dar-85) so a **local** run is
hermetic too, and `test.yml` hand-writes only `BETTER_AUTH_SECRET`. A Sanity-token-less preview
degrades to empty content lists, which the specs tolerate. Keep new tests that way; anything needing
real credentials belongs in a **manual smoke** (below), not the gated suites.

### Manual smokes (not in CI)

Three scripts drive the real endpoints of a built preview over HTTP, no browser. All are **run by
hand** — they need real secrets and write to the dev database — and all exit non-zero on the first
failed assertion. (The first two also need a staff account; `smoke:waitlist` does not, since the flow
it walks is public.) Start `pnpm build && pnpm preview` in one shell, then in another:

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
- `pnpm smoke:waitlist` (`scripts/smoke-waitlist.ts`, DAR-103) — the whole v2 qualification flow
  against a real database: step 1 → 2 → 3 → 4A, the resume cookie, the funnel rows, the per-row
  write budget, append-only, the classifier, the Priority-A claim, and DAR-139's updates gate
  (ask → confirm → audience → login-free withdrawal → the form can't restart it). Needs `DATABASE_*` +
  `BETTER_AUTH_SECRET` + `RESEND_API_KEY` in `.env` and no sign-in at all (the flow is public). A run
  sends **two** emails and both are disclosed rather than suppressed: DAR-82's Priority-A notification
  into `info@`, and DAR-139's confirmation request to the smoke address. It seeds the lead so the
  signup notification and ack never fire, but each of those two is inseparable from the claim it
  asserts — both mailers check the Resend key BEFORE claiming, so a silent run is a run where the
  column was never stamped. The confirmation goes to `delivered@resend.dev` unless
  `SMOKE_WAITLIST_EMAIL` says otherwise; point that at a mailbox you own to actually read the message.
  See [waitlist](waitlist.md#what-only-the-smoke-can-see-dar-103).

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

### Manual content check (not in CI)

`pnpm check:cms` (`scripts/check-cms-boundary.ts`, DAR-171) is the fourth hand-run script and the
only one that needs **no preview** — it talks to Sanity directly. It runs both published-copy
boundaries (the evidence IP rule and the safety-language truth rule) over every CMS document's
prose, which is the one publishing surface no test can see: CI has no `SANITY_VIEWER_TOKEN`
(DAR-96), so every CMS-driven page is empty there. Needs that token in `.env`; it **refuses to run
without one** rather than reporting a clean scan of the single document an anonymous read can see.

```
pnpm check:cms                  # the dataset the site serves, published documents only
pnpm check:cms --dataset=dev    # before promoting: the Studio's working dataset
pnpm check:cms --drafts         # include unpublished drafts
```

Run it before publishing a post that quotes a figure. A safety-language hit is exact — reword. An
**IP hit is a heuristic** and the response is to check the figure against the hub's source of record
first; the failure message says so, because the reflex fix (widen the band) is what turned the
previous version of that guard into a no-op (DAR-152). See
[evidence](evidence.md).

## CI (required checks)

Every PR must pass seven required checks before merge to `main` (which triggers the production
deploy — see [deployment](deployment.md)):

- `lint` ([lint.yml](../.github/workflows/lint.yml))
- `commitlint` + `PR title` ([commitlint.yml](../.github/workflows/commitlint.yml)) — **two jobs because a squash subject has two sources.** The repo is `squash_merge_commit_title: COMMIT_OR_PR_TITLE`, so GitHub takes the subject from the branch commit on a single-commit PR and from the **PR title** on a multi-commit one; wagoid lints commits and never sees the title, so the title path reached `main` unchecked until DAR-175
- `migrations in sync` ([drizzle.yml](../.github/workflows/drizzle.yml)) — drizzle/ trail matches the schema
- `check` ([check.yml](../.github/workflows/check.yml)) — `pnpm check` + a drift guard on the committed `worker-configuration.d.ts` (DAR-49)
- `unit tests` + `e2e` ([test.yml](../.github/workflows/test.yml)) — the three vitest projects, then Playwright against the built Cloudflare bundle (DAR-49)

`actionlint` also runs on workflow changes but isn't a required context.

**A job's `name:` IS the required context**, so renaming one stops it reporting and hangs every open
PR on "Expected — waiting for status to be reported". For a context that is _already_ required the
trap is self-limiting — the PR making the rename is itself unmergeable, and `enforce_admins` is on —
but that also means **adding** a check is two steps: merge the job, then add the context, never the
other way round.

The one rule neither commitlint job enforces is `header-max-length` (100): GitHub appends ` (#N)` to
the subject when it creates the squash commit, so a 96-character subject passes on the PR and is 102
on `main` — where the message can only be changed by force-pushing `main`, so the red X is permanent.
Keep subjects short. Tracked as DAR-174, deliberately not pre-empted here because its two candidate
fixes differ in which repo changes.
