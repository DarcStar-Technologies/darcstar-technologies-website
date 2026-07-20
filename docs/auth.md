# Auth — Better Auth (email/password, admin-only)

Better Auth gates an **internal admin area** at `/admin` (#69) — contact-submission triage plus
operator-roster management (`/admin/users`). Email/password sign-in exists; **public sign-up stays
disabled** (#48) — the FIRST operator is made by the provisioning script (below), and further
operators from the roster UI. This doc maps what's wired and why.

## What's wired

- **`src/lib/server/auth.ts`** — the runtime `betterAuth` instance (a lazy per-request
  singleton; env is read from `getRequestEvent().platform.env`, same reason as `db/index.ts`).
  The drizzle adapter runs on the shared **Turso/libsql** client (`getDb()`, provider `sqlite`);
  the **`admin`** plugin (roster management — see "User management" below) leads the plugin list
  and `sveltekitCookies` stays last; `trustedOrigins` covers the `*.workers.dev` preview/alias
  hosts.
- **`src/lib/server/auth-options.ts`** — the env-free options shared by `auth.ts`, the CLI config,
  and unit tests (so they can't drift and tests import them without `$app/server`/the DB client):
  - `emailAndPassword` — `enabled` but **`disableSignUp: true`** (#48).
  - `rateLimit` — `{ enabled: true, storage: 'database' }` (#69). DB-backed so counters survive
    Cloudflare isolate churn; adds the **`rate_limit`** table (schema-affecting → mirrored in the
    CLI config). Only requests through Better Auth's **router** are limited, which is why the login
    action forwards to `auth.handler()` rather than calling `auth.api.signInEmail` directly.
- **`src/hooks.server.ts`** — `handleBetterAuth` populates `locals.user`/`locals.session` and
  mounts the auth API via `svelteKitHandler` for `/api/auth/*` only. It resolves the session on the
  auth-owned prefixes (`/api/auth/*`, **`/admin`**, **`/login`** — matched on the de-localized path,
  since URLs localize as `/es/*`) **or on any request that carries a Better Auth session cookie**
  (`getSessionCookie(event.request)` — a header-only read, no DB, no auth instance). That cookie
  gate is what lets the navbar reflect sign-in state site-wide (see below) while **anonymous
  visitors — no cookie — still pay no session lookup** (the #48 win, preserved for the traffic that
  matters). Cookie presence only _gates_ the lookup; the real `getSession` still validates, so a
  forged cookie grants nothing. It runs after `handleParaglide` in the `sequence(...)`.
- **`src/lib/server/db/auth.schema.ts`** — the `user`/`session`/`account`/`verification` **and
  `rate_limit`** tables, **generated** by `pnpm run auth:schema` from **`src/lib/server/auth-cli.ts`**
  (a standalone config the Better Auth CLI can load without SvelteKit's virtual modules). Keep
  `auth-cli.ts` in sync with `auth.ts` for **schema-affecting** options only (adapter provider,
  methods, table-adding plugins, `rateLimit.storage: 'database'`) — `disableSignUp` is behavioral,
  so it stays out of the CLI config. The `admin` plugin is schema-affecting (adds
  `user.role/banned/ban_reason/ban_expires` + `session.impersonated_by`), so a **bare `admin()`**
  is mirrored into `auth-cli.ts`; its behavioral options stay in `auth.ts`. Tables reach Turso via
  `pnpm db:push` (schema-first, no migrations dir — see [contact.md](contact.md)); **rerun it after
  schema changes** (it added `rate_limit`, then the admin columns).
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

## The admin area (#69)

The gated surface #48 fenced off:

- **`/login`** (`src/routes/login/`) — email/password sign-in as a **server form action**
  (`+page.server.ts`), so it works **without JS** (native POST → 303 → `/admin`) and progressively
  enhances (`use:enhance` in `LoginForm.svelte`). The action forwards a clean sub-request to
  `getAuth().handler()` so the sign-in traverses the rate limiter — and, because it calls
  `handler()` directly (not via `svelteKitHandler`) with no cookie/origin headers, it sidesteps
  both the `isAuthPath` origin gate and the origin/CSRF check, so it works in every environment
  (no `ORIGIN` match needed). It then forwards Better Auth's session `Set-Cookie` onto the response
  (the router path skips the `sveltekitCookies` plugin). A generic "incorrect email or password"
  covers wrong-password / unknown-account / empty alike (no user enumeration); a 429 surfaces the
  rate-limit. `load` bounces an already-signed-in operator to `/admin`. The same `LoginForm` backs
  the navbar's `LoginDialog` (issue #69 follow-up).
- **`/admin`** (`src/routes/admin/`) — `+layout.server.ts` is the **guard** (`!locals.user` →
  `/login`) and also exposes `isAdmin` (roster admins). A shared **`+layout.svelte`** renders the
  backdrop, the **Submissions | Users** sub-nav (Users only for admins), and the sign-out control —
  which now posts to the global **`/logout`** endpoint, so the submissions `+page.server.ts` no
  longer owns a sign-out action; it just reads the newest `contact_submission` rows (capped,
  newest-first). This replaces `pnpm db:studio` for triaging leads. Pages are `noindex` (a `Seo`
  prop).
- **First-admin provisioning** — `scripts/create-admin.ts` (`pnpm admin:create`). Public sign-up
  stays disabled, so this is the **only** way to create the FIRST operator: it builds a throwaway
  Better Auth instance (same Turso DB + schema, sign-up **enabled**) and calls `signUpEmail`,
  writing the `user`/`account` rows with Better Auth's own password hashing. If the email already
  exists it prints that account's id (to allowlist in `ADMIN_USER_IDS`) instead of failing. See
  [deployment.md](deployment.md). Once an admin exists, further operators are created from the UI.

## User management (roster)

The **Better Auth `admin` plugin** makes `/admin` a two-role area and adds roster management under
**`/admin/users`**: list, view, create, edit (name/email), change role, reset password, force
logout across all sessions, reversibly disable/enable, and hard-delete.

- **Two roles.** `admin` manages the roster **and** views submissions; a plain operator (`user`
  role) signs in and views submissions but **cannot** manage users. New accounts default to `user`
  (the UI labels it "Operator"). Roles use the plugin defaults — no custom access-control statements.
- **Owner bootstrap — `ADMIN_USER_IDS`.** A comma-separated env allowlist of user ids treated as
  admins **before** any role check (`plugins/admin/has-permission.mjs`), so the owner can never be
  locked out even with a null/`user` role. It's a runtime Worker var (read via `readEnv`): set it in
  `.env` locally (`pnpm gen` types it into `Env`) and `wrangler secret put ADMIN_USER_IDS` in prod;
  `pnpm admin:create` prints an existing account's id to copy in. `parseAdminIds` +
  `isRosterAdmin(user, csv)` (`admin-access.ts`) = `role === 'admin' || id ∈ allowlist`, and gate
  both the nav tab and the `/admin/users` route.
- **Behavioral vs schema split.** The plugin's options (`adminUserIds`, `defaultRole`) are
  env-dependent → `auth.ts` only; its static schema is mirrored as a bare `admin()` in `auth-cli.ts`
  (see "What's wired"). `pnpm db:push` adds the nullable columns (additive, safe).
- **Routes.** `/admin` and `/admin/users` share `admin/+layout.svelte`.
  `admin/users/+layout.server.ts` guards the section (non-admin → `/admin`). `/admin/users` lists +
  creates (→ the new operator's detail page); `/admin/users/[id]` manages one account. All actions
  are **no-JS server form actions** → `auth.api.*` (`createUser`, `adminUpdateUser`, `setRole`,
  `setUserPassword`, `revokeUserSessions`, `banUser`/`unbanUser`, `removeUser`). `createUser` is an
  admin op, so it works despite `disableSignUp`. Delete is gated by a required "I understand"
  checkbox (no JS `confirm()` — worker globals aren't typed for svelte-check).
- **Authorization is authoritative.** Every admin endpoint runs `adminMiddleware` →
  `getAuthoritativeSessionFromCtx` (`disableCookieCache: true`), so a demoted operator loses
  management powers immediately at the endpoint — the route guard/nav is defense-in-depth only.
- **Guardrails + a known limit.** `guardTarget` blocks role/password/session/disable/delete against
  **your own** account or an **owner** (`ADMIN_USER_IDS`) account; the plugin also blocks
  self-ban/self-remove. This is a UI foot-gun guard, **not** a hard boundary — the admin API has no
  owner concept, so a promoted admin could still target an owner via `/api/auth/admin/*` directly.
  Admins are trusted operators; the load-bearing guarantee is only that an owner can't be locked out
  by a role mistake.

Tested hermetically (`src/lib/server/admin.spec.ts` — non-admin 403, owner/role admin allowed,
`createUser` despite `disableSignUp`; `admin-access.spec.ts` — the allowlist/role logic), a DB-free
guard e2e (`admin/users/page.svelte.e2e.ts` — unauth `/admin/users` → `/login`), and the full
lifecycle (create → non-admin guard → reset → force-logout → disable → enable → delete) in
`pnpm smoke:signin`.

## Auth-aware UI

The navbar reflects sign-in state so it never shows "Sign in" to a signed-in operator:

- **`src/routes/+layout.server.ts`** — a root layout `load` that exposes a **minimal** snapshot,
  `{ user: locals.user ? { email } : null }`, to every page as `page.data.user` (typed in
  `app.d.ts` as `App.PageData.user`). Email only — the full `User` stays server-only. This is what
  makes the cookie-gated session lookup in `hooks.server.ts` visible to the client.
- **`Header.svelte`** — reads `page.data.user` (`$app/state`). Signed out → the "Sign in"
  link/dialog (unchanged). Signed in → an **Admin** link (→ `/admin`) plus a **Sign out** control,
  in both the desktop and mobile lists. The state flips reactively: `LoginForm`'s `invalidateAll`
  on sign-in and the native `/logout` redirect both re-run the layout `load`.
- **`src/routes/logout/+server.ts`** — a global sign-out endpoint so an operator can sign out from
  any page. The navbar posts a native `<form method="post" action="/logout">` (no JS required);
  `POST` clears the session (`auth.api.signOut`, same as `/admin`'s action) → 303 `/`; a stray
  `GET` → 303 `/`. SvelteKit's CSRF origin-check protects the POST.

Covered by the `pnpm smoke:signin` happy-path (below), which now also asserts the home navbar shows
the signed-in controls with a session cookie and only "Sign in" without one.

Guarded by an e2e (`src/routes/admin/page.svelte.e2e.ts`): unauthenticated `/admin` → `/login`
(DB-free — a no-cookie `getSession` returns null without a query). The happy path (sign-in →
list → sign-out → guard) is a manual smoke, **`pnpm smoke:signin`** (`scripts/smoke-signin.mjs`),
run against any built server (`pnpm preview`) — it signs in through the `/login` form action, which
works on any origin/port. It writes a session, so — like the contact happy-path — it's out of CI.

## Still deferred

**Cloudflare Turnstile (#53)** on the auth endpoints (stronger than rate limiting alone), and
pagination for the submissions **and roster** lists (both capped at 200, newest-first). Public
sign-up stays disabled; GitHub OAuth is configured in the CLI but not enabled in `auth.ts`.
Owner-vs-admin protection at the endpoint level (a promoted admin can still target an owner via the
raw admin API) is out of scope — admins are trusted; see "User management".
