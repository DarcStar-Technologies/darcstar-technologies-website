# Auth — Better Auth (email/password, admin-only)

Better Auth gates an **internal admin area** at `/admin` (#69) — contact-submission triage plus
operator-roster management (`/admin/users`) — **and** an end-user portal at `/account` (#96).
Email/password sign-in exists, and **public sign-up is open but gated** (#96 PR 2, reversing the #48
lockdown): a `/signup` form behind **Cloudflare Turnstile** that creates an **unverified** account,
which `requireEmailVerification` keeps out of sign-in until the email is confirmed. The FIRST
operator is still made by the provisioning script (public sign-up only ever mints a least-privileged
`user`); further operators come from the roster UI. This doc maps what's wired and why.

## What's wired

- **`src/lib/server/auth.ts`** — the runtime `betterAuth` instance (a lazy per-request
  singleton; env is read from `getRequestEvent().platform.env`, same reason as `db/index.ts`).
  The drizzle adapter runs on the shared **Turso/libsql** client (`getDb()`, provider `sqlite`);
  the **`admin`** plugin (roster management — see "User management" below) leads the plugin list
  and `sveltekitCookies` stays last; `trustedOrigins` covers the `*.workers.dev` preview/alias
  hosts.
- **`src/lib/server/auth-options.ts`** — the env-free options shared by `auth.ts`, the CLI config,
  and unit tests (so they can't drift and tests import them without `$app/server`/the DB client):
  - `emailAndPassword` — `enabled`, **`disableSignUp: false`** + **`requireEmailVerification: true`**
    (#96 PR 2; both behavioral, so shared with the CLI config without adding a table).
  - `rateLimit` — `{ enabled: true, storage: 'database', customRules: { '/sign-up/email': { window:
3600, max: 3 }, '/send-verification-email': { window: 3600, max: 5 } } }` (#69, #96, #115). DB-backed
    so counters survive Cloudflare isolate churn; adds the **`rate_limit`** table (schema-affecting →
    mirrored in the CLI config). The `customRules` caps tighten the reopened sign-up (3/hour/IP) and
    the #115 resend-verification trigger (5/hour/IP — a touch looser, since resending is a legitimate
    repeat) past the defaults. Only requests through Better Auth's **router** are limited, which is why
    the login/signup actions forward to `auth.handler()` rather than calling `auth.api.*` directly.
  - `emailVerification` (env-bound → in `auth.ts`, not `auth-options.ts`) — `sendOnSignUp`,
    `autoSignInAfterVerification`, `expiresIn: 3600`, a `sendVerificationEmail` that Resends the link
    (`verification-email.ts`), and an `afterEmailVerification` that runs the ownership backfill
    (`linkSubmissionsToUser`) once ownership is proven. Plus the **`captcha`** plugin
    (`cloudflare-turnstile`, `endpoints: ['/sign-up/email']`) — see "Public sign-up" below.
  - `session` — `{ cookieCache: { enabled: true, maxAge: 300 } }`. Better Auth writes a **signed**
    (HMAC) snapshot of the session+user into a short-lived `session_data` cookie; within `maxAge`
    seconds `getSession` serves from that cookie (signature verify only) instead of querying the DB.
    This matters because #87 made every signed-in page view resolve the session in the hook — without
    the cache that's a DB round-trip per view. **Behavioral, not schema-affecting** (a cookie, no
    table), so it stays OUT of the CLI config. Sign-out clears `session_data` (verified). The cache
    is **bypassed on the auth-owned surfaces** — the hook resolves the session **authoritatively** (a
    DB read) for `/admin`, `/login`, `/api/auth/*` — so an admin's roster **force-logout / disable is
    immediate** (it cuts the target's next `/admin` request, not up to `maxAge` later). The cache only
    serves the site-wide **navbar** reflection on ordinary pages, where a stale "signed in" snapshot
    (≤ `maxAge`) is merely cosmetic — clicking through to `/admin` re-checks.
- **`src/hooks.server.ts`** — `handleBetterAuth` populates `locals.user`/`locals.session` and
  mounts the auth API via `svelteKitHandler` for `/api/auth/*` only. It resolves the session on the
  auth-owned prefixes (`/api/auth/*`, **`/admin`**, **`/login`** — matched on the de-localized path,
  since URLs localize as `/es/*`) **or on any request that carries a Better Auth session cookie**
  (`getSessionCookie(event.request)` — a header-only read, no DB, no auth instance). That cookie
  gate is what lets the navbar reflect sign-in state site-wide (see below) while **anonymous
  visitors — no cookie — still pay no session lookup** (the #48 win, preserved for the traffic that
  matters). Cookie presence only _gates_ the lookup; the real `getSession` still validates, so a
  forged cookie grants nothing (the `session_token` is a signed cookie — a bad signature is rejected
  before any DB read). On an ordinary page view (the navbar reflection) that `getSession` is served
  from the `session_data` **cookie-cache** (no DB) within its `maxAge`; on the auth-owned paths
  (`/admin`, `/login`, `/api/auth/*`) it passes **`disableCookieCache`** for a fresh DB read, so a
  revoked/disabled operator is cut off there immediately — see `session` in auth-options.ts. It runs
  after `handleParaglide` in the `sequence(...)`.
- **`src/lib/server/db/auth.schema.ts`** — the `user`/`session`/`account`/`verification` **and
  `rate_limit`** tables, **generated** by `pnpm run auth:schema` from **`src/lib/server/auth-cli.ts`**
  (a standalone config the Better Auth CLI can load without SvelteKit's virtual modules). Keep
  `auth-cli.ts` in sync with `auth.ts` for **schema-affecting** options only (adapter provider,
  methods, table-adding plugins, `rateLimit.storage: 'database'`) — `disableSignUp`,
  `requireEmailVerification`, `emailVerification`, and the `captcha` plugin are all behavioral (the
  `verification` table + `user.emailVerified` already exist), so they stay out of the CLI config. The
  `admin` plugin is schema-affecting (adds
  `user.role/banned/ban_reason/ban_expires` + `session.impersonated_by`), so a **bare `admin()`**
  is mirrored into `auth-cli.ts`; its behavioral options stay in `auth.ts`. Tables reach Turso via
  **`pnpm db:push`** (the default apply path; a versioned `drizzle/` migration trail also exists —
  see [deployment.md](deployment.md)); **rerun it after schema changes** (it added `rate_limit`,
  then the admin columns).
- **Secrets** — `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` via
  `wrangler secret` + local `.env`. See [deployment.md](deployment.md).

## Public sign-up, verification & Turnstile (#96 PR 2)

Originally (#48) public sign-up was closed (`disableSignUp: true`) because `POST /api/auth/sign-up/email`
was reachable with no UI, no rate limiting, and nothing consuming the session — anyone could create
rows in the production `user` table. That lockdown is now **reopened, scoped** behind three controls,
so the sign-up surface can't be abused:

1. **Cloudflare Turnstile** on `POST /sign-up/email` — the `captcha` plugin (`auth.ts`, provider
   `cloudflare-turnstile`) validates the challenge in its `onRequest`, before any DB write. `endpoints`
   is pinned to **`['/sign-up/email']`**: the plugin's defaults also guard `/sign-in/email` +
   `/request-password-reset`, which have no widget and would break the no-JS `/login`. Registered only
   when `TURNSTILE_SECRET_KEY` is set (dev without keys signs up challenge-free — graceful, like the
   Resend skip). The `/signup` action forwards the widget token as the `x-captcha-response` header.
   **Local `pnpm preview` is always captcha-ACTIVE**: it bakes Cloudflare's always-pass **test**
   keypair via `--var` (DAR-45 — a real sitekey rejects localhost), so a preview POST to
   `/sign-up/email` without a token now 400s, and real-key siteverify behavior can't be observed
   through local preview — only on the deployed preview/prod Workers, whose secrets are real.
2. **`requireEmailVerification: true`** — a sign-up creates an **unverified** account and does NOT sign
   the visitor in (no session token); Better Auth rejects sign-**in** for any unverified user with
   **403 `EMAIL_NOT_VERIFIED`** until they click the emailed link. On verify, `autoSignInAfterVerification`
   drops them into `/account`, and `afterEmailVerification` runs the ownership backfill.
3. **Tighter rate limit** — `rateLimit.customRules['/sign-up/email'] = { window: 3600, max: 3 }` (and
   `['/send-verification-email'] = { window: 3600, max: 5 }` for the #115 resend affordance below).

**Staff-lockout guard (load-bearing):** `requireEmailVerification` blocks sign-in for **every**
`email_verified = 0` user, and all pre-#96 staff were created unverified. Three things keep the roster
in: (a) migration **`drizzle/0003_verify_existing_users`** flips existing rows to verified — it runs on
prod through the deploy-prod migrate-**before**-deploy step, so staff are verified before this code goes
live; (b) roster `createUser` now passes `data: { emailVerified: true }`; (c) `scripts/create-admin.ts`
sets `emailVerified: true`. Verify no staff account is left unverified before merge → deploy. **Caveat:**
`db:push` (the dev-DB apply path) does NOT run `drizzle/*.sql`, so a dev DB that already holds unverified
staff needs the backfill run once by hand (`pnpm db:migrate`, or a one-off `UPDATE user SET
email_verified = 1`) — otherwise local staff sign-in 403s. Prod is covered by the deploy-prod migrate.

An unverified account that later returns to `/login` isn't a dead-end: the sign-in 403s but
`emailVerification.sendOnSignIn` re-mails a fresh link, and the `/login` action surfaces a distinct
"verify your email" message (safe — the 403 fires only after the password check passes, so a wrong
password still returns the generic error and can't enumerate accounts). That "verify your email" state
also shows an explicit **"Resend verification email"** control (`LoginForm.svelte`, shared by the
`/login` page and the navbar `LoginDialog`) → a sibling `resend` action (`login/+page.server.ts`)
forwarding to the same `/send-verification-email` endpoint described below, so a user who never got the
auto-remailed link has a visible way to request another without re-entering their password. It works
no-JS on the `/login` page; in the JS dialog the enhance callback keeps the result local (no
`applyAction`) so the dialog stays open and the sign-in state is untouched.

**Resend from the "check your email" panel (#115).** The `/login` recovery above needs the password.
The other dead-end has none: an unverified account that signs up **again** hits better-auth's
anti-enumeration path — a generic "check your email" that sends **no** mail (the duplicate never
re-triggers a send) — and still can't sign in. So the `form?.ok` panel offers a **"Resend
verification email"** button (`signup/+page.svelte`) posting to a `resend` action
(`signup/+page.server.ts`) that forwards to **`POST /api/auth/send-verification-email`**. That
endpoint is **already non-enumerating**: a 500 ms constant-time floor and an identical `{ status:
true }` whether the address is unverified / already-verified / absent — it mails **only** an existing
unverified account (better-auth `email-verification.mjs`). The action keeps the client outcome uniform
to match (any non-429 → the same neutral "if it needs verifying, a link is on its way" confirmation;
429 → "too many attempts"), and always returns `ok: true` so the panel stays put. It's **outside** the
captcha scope (`endpoints: ['/sign-up/email']`), so **no widget/token is needed — resend works no-JS**
(unlike sign-up itself), rate-limited at 5/hour/IP. Pinned by `auth.spec.ts` (identical response for
absent/unverified/verified; a mail fires only for the real unverified account).

The routes mirror `/login`: `/signup` (`src/routes/signup/`) is a form action forwarding a clean
sub-request to `getAuth().handler()` (so it rides the rate limiter + captcha), showing a **"check your
email"** panel on success (duplicate emails return the same generic 200 — better-auth genericizes them
under `requireEmailVerification`, so the form can't enumerate accounts). **Sign-up requires JS** — the
Turnstile widget (rendered via an `{@attach}`, the repo's DOM pattern) has no no-JS path; this is the one
accepted deviation from the no-JS `/login`/`/contact`.

Hermetic unit test (`src/lib/server/auth.spec.ts`, server project): it feeds the shared
`emailAndPassword` config (`auth-options.ts`) to a throwaway in-memory instance and asserts sign-up now
succeeds (unverified, no token) **and** that unverified sign-in is rejected, with a control (verification
off) proving `requireEmailVerification` is what blocks it. The email builder is unit-tested
(`verification-email.spec.ts`); anon `/signup` renders is an e2e (`signup/page.svelte.e2e.ts`). **Not an
endpoint e2e:** Better Auth's `isAuthPath()` drops any request whose origin ≠ `ORIGIN`, and the preview
serves on `localhost:4173`, so `/api/auth/*` 404s there before any auth logic runs. **Turnstile keys** —
create a widget in the Cloudflare dashboard for darcstar.tech (public site key + secret); set
`TURNSTILE_SECRET_KEY` via `wrangler secret put` (+ `--env preview`) and `TURNSTILE_SITE_KEY` per env.

## Password reset (self-service)

Better Auth's built-in `forget-password` flow, wired to Resend and two form-action pages. **No schema
change** — the reset token lives in the existing `verification` table (identifier `reset-password:<token>`);
config is behavioral only, so it stays out of `auth-cli.ts`.

**Config** (`auth.ts`, augmenting the shared `emailAndPassword`): `sendResetPassword` renders + Resends
the link (`password-reset-email.ts`, mirroring `verification-email.ts`; graceful dev skip logs the link
when there's no Resend key), `resetPasswordTokenExpiresIn: 3600` (1 hour), and
**`revokeSessionsOnPasswordReset: true`** — a reset signs out all the user's OTHER sessions, so
recovering a compromised account doesn't leave the attacker signed in.

**Flow (two pages, each a single `default` action — never mix `default` + named, per #122):**

1. **`/forgot-password`** — enter email → forwards to `POST /request-password-reset` `{ email,
redirectTo: '/reset-password' }`. That endpoint is **anti-enumerating** (better-auth `password.mjs`
   simulates the token path + a dummy verification lookup for an unknown email, returning an identical
   `{ status: true }`) and sends only for a real account. The action keeps the client outcome uniform to
   match — any non-429 → the same generic "check your email" — so the form can't enumerate registered
   addresses. Rate-limited at **3/hour/IP** (`/request-password-reset`, an email-send trigger).
2. Email link → **`GET /reset-password/:token?callbackURL=/reset-password`** — better-auth validates the
   token and redirects to `/reset-password?token=…` (valid) or `?error=INVALID_TOKEN` (bad/expired/used).
3. **`/reset-password`** — `load` reads the token/error; the form POSTs `{ newPassword, token }` (the
   token rides a hidden field, so a no-JS re-render doesn't depend on the URL query) to
   `POST /reset-password`. Success → a "password updated, sign in" panel (the flow is anonymous — no
   auto-sign-in); an invalid/expired token → an "invalid link" panel pointing back to `/forgot-password`.
   Rate-limited at 10/hour/IP.

Entry point: a **"Forgot your password?"** link in the login chrome — duplicated in `login/+page.svelte`
and `LoginDialog.svelte` (the dialog closes on click), the same pattern as the sign-up prompt. The whole
flow is **no-JS friendly** (no Turnstile — the reset endpoints are outside the captcha scope) and works
for staff and end-users alike.

Hermetic tests (`auth.spec.ts`): request-password-reset is anti-enumerating (identical response for
absent vs existing; a mail fires only for the real account), a valid token sets the new password (the old
one stops working) while a consumed/bogus token is rejected, and a control proves our `sendResetPassword`
callback is what enables the endpoint. Email builder unit-tested (`password-reset-email.spec.ts`); the
`/forgot-password` + `/reset-password` action shapes are covered by the named-actions guard
(`auth-named-actions.spec.ts`).

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
  only ever mints an unverified `user`, so this is still the **only** way to create the FIRST
  operator: it builds a throwaway Better Auth instance (same Turso DB + schema) and calls
  `signUpEmail`, writing the `user`/`account` rows with Better Auth's own password hashing, then
  promotes the row to `role: 'admin'` **and `emailVerified: true`** (so `requireEmailVerification`
  doesn't lock the owner out). It's **idempotent**: if the email already exists it **resets that
  account's password** to `ADMIN_PASSWORD`, re-asserts the `admin` role + verified flag, and prints
  the id (to allowlist in `ADMIN_USER_IDS`) — so a re-run doubles as a password reset for the owner.
  (Since the #94 DB split it targets the **dev** DB by default — `.env` — so pass prod `DATABASE_*`
  inline to provision prod.) See [deployment.md](deployment.md). Once an admin exists, further
  operators are created from the UI.

## User management (roster)

The **Better Auth `admin` plugin** makes `/admin` a role-gated staff area and adds roster management
under **`/admin/users`**: list, view, create, edit (name/email), change role, reset password, force
logout across all sessions, reversibly disable/enable, and hard-delete.

- **Three roles (#95).** `admin` = super user: manages the roster **and** reads/deletes all messages.
  `operator` = staff: reads **and deletes** submissions (the `/admin` triage view), but **cannot**
  manage the roster. `user` = end-user: their own account/data only, **no** `/admin` access — dormant
  until the portal (#96). `/admin` is gated by **`isStaff`** (admin **or** operator), not mere
  authentication, so a `user`/role-less account is bounced home; `/admin/users` stays
  `isRosterAdmin`-only. Roster-created accounts **default to `user`** (least privilege — no `/admin`
  until promoted to `operator`/`admin`), matching `defaultRole: 'user'` (which otherwise applies only
  to disabled public sign-up). The `/admin/users` page is worded as general **user** management, not
  "operators". Roles are plugin-
  default free strings (no access-control statements), so **`admin-access.ts`** is the single place
  that constrains + gates them — `ROLES`/`coerceRole` (validate what the roster writes), `isStaff`
  (the `/admin` gate), `apiRole` (Better Auth types the API `role` as `'admin'|'user'`, so cast our
  validated `Role` through — authorization is our gates + `adminRoles`, not these labels).
- **Owner bootstrap — `ADMIN_USER_IDS`.** A comma-separated env allowlist of user ids treated as
  admins **before** any role check (`plugins/admin/has-permission.mjs`), so the owner can never be
  locked out even with a null/`user` role. It's a runtime Worker var (read via `readEnv`): set it in
  `.env` locally (`pnpm gen` types it into `Env`) and `wrangler secret put ADMIN_USER_IDS` in prod;
  `pnpm admin:create` prints an existing account's id to copy in — and now also sets that account's
  DB `role = 'admin'` (#95), so admin status is visible in the data, with the allowlist as break-glass. `parseAdminIds` +
  `isRosterAdmin(user, csv)` (`admin-access.ts`) = `role === 'admin' || id ∈ allowlist`, and gate
  both the nav tab and the `/admin/users` route.
- **Behavioral vs schema split.** The plugin's options (`adminUserIds`, `adminRoles`, `defaultRole`)
  are behavioral/env-dependent → `auth.ts` only; its static schema is mirrored as a bare `admin()` in
  `auth-cli.ts` (see "What's wired"). `pnpm db:push` adds the nullable columns (additive, safe).
- **Routes.** `/admin` and `/admin/users` share `admin/+layout.svelte`. The `/admin` submissions view
  has a **`delete` form action** (staff-only via `isStaff`) to remove a lead (#95) — a per-row no-JS
  POST. `admin/users/+layout.server.ts` guards the roster section (non-admin → `/admin`).
  `/admin/users` lists + creates (→ the new operator's detail page); `/admin/users/[id]` manages one
  account. All actions
  are **no-JS server form actions** → `auth.api.*` (`createUser`, `adminUpdateUser`, `setRole`,
  `setUserPassword`, `revokeUserSessions`, `banUser`/`unbanUser`, `removeUser`). `createUser` is an
  admin op (it bypasses the public sign-up captcha/verification path) and passes
  `data: { emailVerified: true }` so the vouched account can sign in immediately (#96 PR 2). Delete is
  gated by a required "I understand" checkbox (no JS `confirm()` — worker globals aren't typed for
  svelte-check).
- **Authorization is authoritative.** Every admin endpoint runs `adminMiddleware` →
  `getAuthoritativeSessionFromCtx` (`disableCookieCache: true`), so a demoted operator loses
  management powers immediately at the endpoint — the route guard/nav is defense-in-depth only. The
  `/admin` **page** guard is fresh too: the hook resolves `/admin`'s session with `disableCookieCache`
  (see `hooks.server.ts`), so a **force-logout / disable takes effect on the target's next request**
  rather than lingering behind the `session_data` cookie-cache.
- **Guardrails + a known limit.** `guardTarget` blocks role/password/session/disable/delete against
  **your own** account or an **owner** (`ADMIN_USER_IDS`) account; the plugin also blocks
  self-ban/self-remove. This is a UI foot-gun guard, **not** a hard boundary — the admin API has no
  owner concept, so a promoted admin could still target an owner via `/api/auth/admin/*` directly.
  Admins are trusted operators; the load-bearing guarantee is only that an owner can't be locked out
  by a role mistake.

Tested hermetically (`src/lib/server/admin.spec.ts` — non-admin 403, owner/role admin allowed,
`createUser` as an admin op; `admin-access.spec.ts` — the allowlist/role logic), a DB-free
guard e2e (`admin/users/page.svelte.e2e.ts` — unauth `/admin/users` → `/login`), and the full
lifecycle (create → non-admin guard → reset → force-logout → disable → enable → delete) in
`pnpm smoke:signin`.

## Auth-aware UI

The navbar reflects sign-in state so it never shows "Sign in" to a signed-in operator:

- **`src/routes/+layout.server.ts`** — a root layout `load` that exposes a **minimal** snapshot,
  `{ user: locals.user ? { email } : null, isStaff }`, to every page (typed in `app.d.ts` as
  `App.PageData`). Email only — the full `User` stays server-only. `isStaff` (from
  `admin-access.ts`) is a **separate** key, not nested in `user`, so the admin/account layouts that
  override `user` with their own page data can't shadow it. This is what makes the cookie-gated
  session lookup in `hooks.server.ts` visible to the client.
- **`Header.svelte`** — reads `page.data.user` + `page.data.isStaff` (`$app/state`). Signed out →
  the "Sign in" link/dialog (unchanged). Signed in → a **dashboard** link + a **Sign out** control,
  in both the desktop and mobile lists; `isStaff` picks the dashboard link — **Admin** (→ `/admin`)
  for staff, **Account** (→ `/account`, #96) for an end-user. The state flips reactively:
  `LoginForm`'s `invalidateAll` on sign-in and the native `/logout` redirect both re-run the load.
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

## End-user account portal (`/account`, #96)

Activates the dormant `user` role — a self-service surface for **end-users** (leads), entirely
separate from the staff `/admin` UI. **PR 1:** message ownership + the portal. **PR 2:** public
sign-up + email verification + Turnstile (see "Public sign-up, verification & Turnstile" above). A
signed-in end-user who lands on `/admin` (e.g. via a `/login` success, which 303s to `/admin`) is
bounced to `/account`, so self-registered users reach their portal rather than the marketing home.

- **Message ownership.** `contact_submission` gains a nullable `userId` FK (`onDelete: 'set null'`
  — a deleted account leaves the lead as an anonymous row). It's set at three trustworthy moments,
  all via `linkSubmissionsToUser(db, userId, email)` (`src/lib/server/contact-ownership.ts`, a
  case-insensitive `UPDATE … WHERE lower(email)=? AND user_id IS NULL`): (1) a **signed-in submit**
  (`contact.remote.ts` reads `locals.user`), (2) **admin creates an account** (the roster `create`
  action — the admin vouches for the email; best-effort, never fails the create), and (3)
  **self-registered email verification** (`auth.ts` `afterEmailVerification`, #96 PR 2) — ownership is
  proven, so the backfill runs. See [contact](contact.md).
- **`/account`** (`src/routes/account/`) — gated by `+layout.server.ts` to **any signed-in account**
  (no `isStaff` check: end-users are exactly who `/admin` bounces; staff can visit too, it just
  shows their own data). The layout is added to `SESSION_PREFIXES` in `hooks.server.ts`. The page
  lists **only this account's** messages (`WHERE user_id = locals.user.id` — the load-bearing
  isolation property) and offers self-service `updateName` / `changePassword` form actions, which
  call Better Auth's session-scoped `auth.api.updateUser` / `auth.api.changePassword` (act on the
  current session's user, never a `userId` param). **Email is immutable here** — it's the sign-in
  identity and the backfill key; staff change it via `/admin/users`. Each action self-authorizes on
  `locals.user` (form actions skip the layout guard).
- Guarded by an e2e (`src/routes/account/page.svelte.e2e.ts`): unauthenticated `/account` → `/login`
  (DB-free). `linkSubmissionsToUser` is unit-tested (`contact-ownership.spec.ts`, in-memory libsql).

## Login audit

Every sign-in **attempt** — success and failure — is recorded, so failed logins are trackable (who's
targeted, from where, and whether a run eventually succeeded). Two channels: a durable DB row **and** a
structured server-side log line (Cloudflare Workers Logs — `observability.logs` is enabled + persisted
in `wrangler.jsonc`).

- **Capture point — a Better Auth `hooks.after` middleware** (`src/lib/server/auth-audit.ts`,
  `createLoginAuditHook`). Registered in `auth.ts` (`hooks: { after: … }`). It fires for **both** the
  `/login` form action (which calls `auth.handler()`) and a direct `POST /api/auth/sign-in/email`, so
  it's the single chokepoint. Gated to `ctx.path === '/sign-in/email'`. Outcome comes from
  `ctx.context.returned`: an **`APIError`** on failure (`isAPIError` → `.statusCode`/`.body.code`) or
  the result object on success (`ctx.context.newSession.user.id` links the account). Client IP via
  `getIp` (raw — consistent with `session.ip_address`), UA from the headers. It **never reads/logs the
  password**, and **returns `undefined`** so the response — and the anti-enumeration generic error — is
  untouched; the audit is server-side only.
- **The one gap: rate-limit 429s.** Better Auth's limiter rejects in the router's `onRequest`, _before_
  endpoint dispatch, so a 429 never reaches the after-hook. The `/login` action's existing
  `res.status === 429` branch records those itself (it holds the email + client IP). Direct-API calls
  aren't rate-limited, so there's no gap and no double-count.
- **Storage — `login_audit`, an APP-owned table** (`db/schema.ts`, alongside `contact_submission`), so
  it is intentionally **not** in `auth.schema.ts` and **not** mirrored in `auth-cli.ts`; the `hooks`
  option is behavioral (adds no table), so it too stays out of the CLI config. Columns: `email`,
  `userId` (nullable FK, `set null`), `success`, `reason` (`invalid_credentials`/`banned`/
  `email_not_verified`/`rate_limited`/raw code — `email_not_verified` distinguishes the new #96 PR 2
  403 from a ban), `status`, `ipAddress`, `userAgent`, `createdAt`; indexed by `createdAt`,
  `(email, createdAt)`, `(ipAddress, createdAt)`, `userId`. Migration `drizzle/0002_*`.
- **Never breaks or slows sign-in.** The log line is emitted synchronously; the row is persisted by
  `persistLoginAudit` (`src/lib/server/login-audit-store.ts`) via `platform.ctx.waitUntil` (runs after
  the response on workerd; a floating promise in dev), wrapped in try/catch → a DB failure logs and is
  swallowed. The env-bound store is kept separate from the pure hook so `auth-audit.spec.ts` can wire
  the real hook onto an in-memory Better Auth instance (like `auth.spec.ts`) and assert it records
  failure + success with the right email/IP/userId — no DB, no env.
- **View — `/admin/audit`** (`src/routes/admin/audit/`), a read-only, staff-gated table (newest-first,
  capped at 200) beside the submissions triage; the `/admin` layout guard is the only gate needed (no
  actions). _(Visible to all staff; narrow to `data.isAdmin` if you want roster-admins only.)_

## Still deferred

Pagination for the submissions **and roster** lists (both capped at 200, newest-first); GitHub OAuth
is configured in the CLI but not enabled in `auth.ts`; owner-vs-admin protection at the endpoint level
(a promoted admin can still target an owner via the raw admin API) is out of scope — admins are
trusted; see "User management". Sign-up UI copy (like all `es` strings) mirrors `en` untranslated
(#18); email-change self-service in `/account` stays deferred (email is the sign-in + backfill key).
