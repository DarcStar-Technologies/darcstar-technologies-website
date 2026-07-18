# Auth — Better Auth (server-only, locked down)

Better Auth is wired **server-side only**. There is deliberately **no sign-in UI, no sign-up
flow, and no route that reads the session yet** — the gated area that will use it (an in-app
admin view of contact submissions) is deferred to **#69**. Until then auth is kept locked down
(issue #48); this doc is the map of what exists and why it's fenced off.

## What's wired

- **`src/lib/server/auth.ts`** — the runtime `betterAuth` instance (a lazy per-request
  singleton; env is read from `getRequestEvent().platform.env`, same reason as `db/index.ts`).
  The drizzle adapter runs on the shared **Turso/libsql** client (`getDb()`, provider `sqlite`);
  `sveltekitCookies` is last in the plugin list; `trustedOrigins` covers the `*.workers.dev`
  preview/alias hosts.
- **`src/lib/server/auth-options.ts`** — the env-free `emailAndPassword` config (`enabled` but
  **`disableSignUp: true`**), split out of `auth.ts` so unit tests can import it without pulling
  in `$app/server`/the DB client (see the test below).
- **`src/hooks.server.ts`** — `handleBetterAuth` populates `locals.user`/`locals.session` and
  mounts the auth API via `svelteKitHandler`. It's **confined to `/api/auth/*`** (Better Auth's
  default `basePath`): any other path early-returns, so ordinary page views don't pay a session
  lookup and the auth API can't touch the rest of the app. Grow the prefix when protected routes
  land. It runs after `handleParaglide` in the `sequence(...)`.
- **`src/lib/server/db/auth.schema.ts`** — the `user`/`session`/`account`/`verification` tables,
  **generated** by `pnpm run auth:schema` from **`src/lib/server/auth-cli.ts`** (a standalone
  config the Better Auth CLI can load without SvelteKit's virtual modules). Keep `auth-cli.ts` in
  sync with `auth.ts` for **schema-affecting** options only (adapter provider, methods,
  table-adding plugins) — `disableSignUp` is behavioral, so it stays out of the CLI config.
  Tables reach Turso via `pnpm db:push` (schema-first, no migrations dir — see [contact.md](contact.md)).
- **Secrets** — `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` via
  `wrangler secret` + local `.env`. See [deployment.md](deployment.md).

## The #48 lockdown

`hooks.server.ts` ran the auth middleware on **every** request and exposed the full
`/api/auth/*` surface — including `POST /api/auth/sign-up/email` — with no UI, no rate limiting,
and nothing consuming the session. Anyone hitting the sign-up endpoint could create rows in the
production `user` table. Two-part fix:

1. **`disableSignUp: true`** — public account creation is closed. Better Auth rejects sign-up
   with **400** ("Email and password sign up is not enabled") **before any DB write**. Sign-in
   stays enabled so a first admin, provisioned out-of-band, can log in once #69 exists.
2. **Middleware confined to `/api/auth/*`** — kills the per-page-view session lookup and shrinks
   the reachable surface to the auth namespace.

Guarded by a hermetic unit test (`src/lib/server/auth.spec.ts`, server project): it feeds the
shared `emailAndPassword` config (`auth-options.ts`) to a throwaway in-memory Better Auth instance
and asserts sign-up is rejected ("sign up is not enabled"), with a positive control proving
`disableSignUp` is what does it. **Not an e2e:** Better Auth's `isAuthPath()` drops any request
whose origin ≠ the configured `baseURL`/`ORIGIN`, and the e2e preview serves on `localhost:4173`
while `ORIGIN` is the production host — so `/api/auth/*` **404s in the preview before any auth
logic runs**, making an endpoint-level e2e meaningless there.

## Deferred to #69 (do not add piecemeal)

Sign-in UI, **rate limiting** on the auth endpoints (the issue defers it — "add when it goes
real"), first-admin provisioning, and the gated submissions view. When that work starts, re-open
the relevant endpoints, add rate limiting, and widen the `AUTH_API_PREFIX` gate to the protected
routes.
