# Auth — Better Auth (email/password, admin-only)

Better Auth gates an **internal admin area** at `/admin` (#69) — contact-submission triage plus
operator-roster management (`/admin/users`) — **and** an end-user portal at `/account` (#96).
Email/password sign-in exists, and **accounts are invite-only** (DAR-67, re-closing what #96 PR 2 had
opened): `disableSignUp` rejects `POST /sign-up/email` at the router, `/signup` is now a notice
pointing at the waitlist, and an account comes into existence in exactly **two** ways — staff invite a
prospect from `/admin/waitlist`, or an admin creates one on the roster (`/admin/users`). The FIRST
operator is still made by the provisioning script. This doc maps what's wired and why.

## What's wired

- **`src/lib/server/auth.ts`** — the runtime `betterAuth` instance (a lazy per-request
  singleton; env is read from `getRequestEvent().platform.env`, same reason as `db/index.ts`).
  The drizzle adapter runs on the shared **Turso/libsql** client (`getDb()`, provider `sqlite`);
  the **`admin`** plugin (roster management — see "User management" below) leads the plugin list
  and `sveltekitCookies` stays last; `trustedOrigins` covers the `*.workers.dev` preview/alias
  hosts.
- **`src/lib/server/auth-options.ts`** — the env-free options shared by `auth.ts`, the CLI config,
  and unit tests (so they can't drift and tests import them without `$app/server`/the DB client):
  - `emailAndPassword` — `enabled`, **`disableSignUp: true`** (DAR-67 — the invite-only boundary) +
    **`requireEmailVerification: true`** (#96 PR 2; both behavioral, so shared with the CLI config
    without adding a table). Also exports the two token lifetimes:
    **`RESET_PASSWORD_TOKEN_TTL_SECONDS`** (3600 — better-auth's `resetPasswordTokenExpiresIn`, and the
    "expires in one hour" copy in the reset email) and **`ACTIVATION_TOKEN_TTL_SECONDS`** (604800 — a
    week, for DAR-67's invitations). Two numbers, not one: see "Invite-only onboarding" for why, and why
    they can be different at all.
  - `rateLimit` — `{ enabled: true, storage: 'database', customRules: { '/sign-up/email': { window:
3600, max: 3 }, '/send-verification-email': { window: 3600, max: 5 } } }` (#69, #96, #115). DB-backed
    so counters survive Cloudflare isolate churn; adds the **`rate_limit`** table (schema-affecting →
    mirrored in the CLI config). The `customRules` cap sign-up (3/hour/IP — kept after DAR-67 closed
    the endpoint, since the limiter runs first and so bounds probing of a permanently-400ing route) and
    the #115 resend-verification trigger (5/hour/IP — a touch looser, since resending is a legitimate
    repeat) past the defaults. Only requests through Better Auth's **router** are limited, which is why
    the login action forwards to `auth.handler()` rather than calling `auth.api.*` directly — and
    conversely why DAR-67's invite calls `auth.api.*`, to stay OFF the public reset limiter.
    **The store is the one env-bound thing here** (DAR-81, in `auth.ts` rather than the shared config):
    `AUTH_RATE_LIMIT_STORAGE=memory` runs the limiter without a database, and `pnpm preview` bakes it
    because the limiter executes ahead of every auth route — against the e2e suite's placeholder
    `DATABASE_URL` that made every `/api/auth/*` request a 500, `GET /ok` included, so no auth boundary
    could be asserted end-to-end. Polarity is **fail-safe**: only the exact literal `memory` switches
    the store, so unset/blank/a typo all keep the durable table, and `wrangler.jsonc` never declares the
    var — memory storage is per-isolate, which on Cloudflare is no rate limiting at all, and that must
    take a deliberate act rather than a mistake. Not schema-affecting (the `rate_limit` table stays), so
    the CLI config is untouched.
  - **`CLIENT_IP_HEADER` + `advanced`** (DAR-124) — `advanced.ipAddress.ipAddressHeaders:
['cf-connecting-ip']`, the header Better Auth resolves a client address from for **both** the
    rate-limit bucket key and `login_audit.ip_address`. Better-auth's default `x-forwarded-for` is
    caller-controlled at a Worker (measured — see "The bucket key is the edge's" below). Exported as
    one constant because `auth-subrequest.ts` must set the same header the limiter reads, and a
    mismatch produces no error at all — just every form submission sharing one bucket. Behavioral, so
    it stays OUT of the CLI config.
  - `emailVerification` (env-bound → in `auth.ts`, not `auth-options.ts`) — `sendOnSignUp`,
    `autoSignInAfterVerification`, `expiresIn: 3600`, a `sendVerificationEmail` that Resends the link
    (`verification-email.ts`), and an `afterEmailVerification` that runs the ownership backfill
    (`linkSubmissionsToUser`) once ownership is proven. Also `emailAndPassword.onPasswordReset` —
    DAR-67's activation stamp (see below). The **`captcha`** plugin was removed with public sign-up.
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
  `requireEmailVerification`, `emailVerification` and `onPasswordReset` are all behavioral (the
  `verification` table + `user.emailVerified` already exist), so they stay out of the CLI config. The
  `admin` plugin is schema-affecting (adds
  `user.role/banned/ban_reason/ban_expires` + `session.impersonated_by`), so a **bare `admin()`**
  is mirrored into `auth-cli.ts`; its behavioral options stay in `auth.ts`. Tables reach Turso via
  **`pnpm db:push`** (the default apply path; a versioned `drizzle/` migration trail also exists —
  see [deployment.md](deployment.md)); **rerun it after schema changes** (it added `rate_limit`,
  then the admin columns).
- **Secrets** — `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` via
  `wrangler secret` + local `.env`. See [deployment.md](deployment.md).

## Invite-only onboarding (DAR-67)

Public sign-up has now been closed twice. #48 closed it because `POST /api/auth/sign-up/email` was
reachable with no UI, no rate limiting and nothing consuming the session; #96 PR 2 reopened it behind
Turnstile + email verification + a 3/hour cap; **DAR-67 closes it again**, this time as a product
decision rather than a security one — early access is something we hand out, not something a stranger
takes. The mechanism is different too: the door is shut and there is a **staff-operated side entrance**.

**The boundary is `emailAndPassword.disableSignUp: true`** (`auth-options.ts`). Better Auth rejects
the endpoint with `EMAIL_PASSWORD_SIGN_UP_DISABLED` before any DB write (`api/routes/sign-up.mjs`).
Hiding the page is cosmetic; this line is the gate. The admin plugin's `create-user` is a **different
endpoint that never consults the flag**, which is what keeps both staff paths working — pinned by
`auth.spec.ts`, which drives the shipped config and asserts the refusal, the surviving staff path, and
a control with the flag flipped off.

**`/signup` survives as a notice.** Deleting the route would 404 every bookmark, emailed link and
stale search result — exactly the audience that needs to be told the door moved rather than that it
vanished. It has **no actions at all** (asserted by `auth-named-actions.spec.ts`, so a future re-open
has to make the default-vs-named decision deliberately) and links to `/waitlist`. The three
"need an account?" links — the `/login` page, the navbar `LoginDialog`, and the navbar itself
("Request access") — now point **straight at `/waitlist`** rather than at the notice, since a notice
in the middle is one click of nothing. All of them carry `data-sveltekit-preload-data="tap"`: they are
links to `/waitlist`, whose load records the DAR-66 funnel's `waitlist_viewed`, and the navbar one is
on every page (see docs/waitlist.md).

**Turnstile is gone.** The `captcha` plugin was scoped to `['/sign-up/email']` and that endpoint now
rejects everything, so it guarded nothing — and keeping it would have been worse than dead weight,
because its `onRequest` runs _before_ the sign-up check, so a probe would have come back "solve the
captcha" instead of "sign-up is disabled". What was **kept** so re-opening is a one-line plugin
re-registration rather than an infrastructure change: `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` in
the env, the `challenges.cloudflare.com` CSP allowlist in `vite.config.ts`, and the preview's
always-pass test keys. `security-headers.e2e.ts` lost only its `/signup` **widget-ready hook** (there
is no widget to wait for); the origin stays covered by that suite's synthetic probes.

### The invite (staff → prospect)

An `invite` form action on `/admin/waitlist`, gated on **`isStaff`** like the rest of the area
(operators too — the account it creates is always the least-privileged `user`, so there is no
escalation to reach through it). No JS required; two-step `<details>` confirm, same as delete.

1. **Find or create the account.** `findAccountByEmail` (`waitlist-invite.ts`) queries the `user`
   table directly rather than via `auth.api.listUsers`, which is admin-only and would 403 an operator
   on a read. If the address already holds a **staff** account the invite is refused
   (`staff_account`): the link is a password-reset token, and the button must not become a way to
   fire credential mail at a colleague. Otherwise `auth.api.createUser` mints it with role `user`,
   `emailVerified: true` (staff vouch by choosing the row; without it `requireEmailVerification`
   would 403 the invitee with no way out) and **no password at all** — better-auth treats it as
   optional and simply omits the credential record, so there is never a server-generated password
   nobody chose. Headers are deliberately **not** forwarded, making it a trusted server-side call
   authorized by our own `isStaff` gate (with a request attached the endpoint demands an _admin_
   session). Then `linkSubmissionsToUser` claims their earlier anonymous contact submissions, the
   same vouch the roster path makes.
2. **Mint the link.** `mintActivationLink` (`activation.ts`) writes a `verification` row under
   better-auth's own `reset-password:<token>` identifier, so the emailed link is redeemable by the
   existing `/reset-password` flow — single-use, session-revoking — instead of needing a second
   credential-setting path. It carries a **week-long** expiry rather than the reset flow's hour (see
   below). **Not** `auth.api.requestPasswordReset`, for two reasons: it is
   capped at 3/hour/IP (right for a public trigger, wrong for a staff batch), and it _swallows send
   failures_ — `runInBackgroundOrAwait` logs and returns `{ status: true }` regardless.
3. **Send it, awaited.** `sendActivationEmail` (`activation-email.ts`, Resend). It shares its
   **layout** with `password-reset-email.ts` + `verification-email.ts` (`link-email.ts`, DAR-181 —
   the three were byte-identical apart from their message prefix), but not its **failure policy**: this is the
   **one outbound mail in the codebase that is awaited and whose failure surfaces**. Fire-and-forget
   is right when dropping a visitor's own submission would be worse, but here the operator is the
   only person who can retry — so the send stays in this module, which is also what
   `email-senders.spec.ts` requires (see [legal](legal.md)).
4. **Stamp, then log.** Only now does `markWaitlistInvited` set `invited_at`/`invited_by`, so the
   column means "a message was accepted by Resend", never "we tried" — a send failure leaves the row
   looking un-invited and the button still saying Invite, which is the correct next move. Retrying is
   safe: the account from the failed attempt is found, not duplicated. A structured
   `[invite] activation.sent` line goes to Workers Logs (mirroring the login-audit posture) and is the
   only durable history of who invited whom, since a resend overwrites `invited_at`.

**Why an invitation lasts a week and a reset lasts an hour.** They answer different questions. A reset
is minted seconds after someone asks for it, with the tab still open — an hour is generous. An
invitation arrives _unrequested_, and the recipient may not open that mailbox until the weekend; an hour
would mean most invitations were dead on arrival, and the recovery path (a fresh link from
`/forgot-password`) requires guessing that you have an account at all.

The two can differ because `resetPasswordTokenExpiresIn` governs only what better-auth's own
`requestPasswordReset` endpoint _stamps_. Expiry is **enforced from the verification row's
`expiresAt`** — at the GET callback and again in `consumeVerificationValue` — so a hand-minted token
carries its own lifetime while the public reset flow keeps its short one. That is the property the whole
scheme rests on, so `activation.spec.ts` ages a minted row through the context adapter and proves
better-auth rejects it; without that test, a change in better-auth could silently cut every invitation
back to an hour while the email still promised a week, and a fresh-token test would keep passing.

**Known trade-off.** The invite mints the same kind of token for an address that ALREADY has an account
(a resend to someone who activated long ago), and there a week-long token is a week-long password-reset
window on a live credential rather than on an empty account. It still only ever goes to the account's
own address and it's a deliberate staff action, so the exposure is a mailbox compromise within the week.
Scoping the TTL by whether the account was just created was considered and rejected: the email copy
would then have to state two different lifetimes, and copy that lies about expiry is worse than the
wider window.

**Local dev without Resend.** With no `RESEND_API_KEY` the invite logs the activation link and returns
a FAILURE rather than claiming success, because nothing was mailed — so `invited_at` stays null. That is
deliberate, but it has a consequence worth knowing before you go looking for a bug: since
`markWaitlistActivated` requires `invited_at IS NOT NULL`, clicking the logged link and setting a
password will **not** flip the badge to Activated locally. To exercise that path end to end you need a
real Resend key (send to a throwaway address, not your own inbox), or to set `invited_at` by hand.

### Activation state

Three columns on `waitlist_lead` (**not** on `user` — the un-invited majority has no `user` row to
hang them off; and since DAR-88 not on a signup row either, because a person has N append-only
submissions and hanging an invitation off one of them would leave the rest looking un-invited):
`invited_at`, `invited_by` (a staff id, deliberately not an FK: an audit breadcrumb must not cascade
away with a departed operator), `activated_at`. The badge state is **derived on read**
(`waitlistInviteState`, `$lib/waitlist-invite.ts`), like DAR-65's lead class.

`activated_at` is stamped by better-auth's **`onPasswordReset`** hook (`auth.ts`) — the only place
that sees the event, since `/reset-password` goes through better-auth, which knows nothing about the
waitlist. The hook fires for **every** reset on the site, so the discrimination lives in the query:
`markWaitlistActivated` stamps only where `invited_at IS NOT NULL` (an ordinary reset by someone never
invited must not claim an onboarding that never happened) **and** `activated_at IS NULL` (monotonic —
it records when they _first_ set a password, not the last time they changed it). It leaves
`updated_at` alone, which tracks the visitor's own edits. Best-effort and fully swallowed: a
reporting timestamp must never fail someone's password reset. Pinned by `waitlist-invite.spec.ts`
against in-memory libsql, because the guarantees are in the WHERE clause.

### What the invitee sees

The link lands on **`/reset-password?invite=1&token=…`** — the same page, same action, same token;
only the copy changes ("Set your password", not "Set a _new_ password"). The flag is **cosmetic
only**: anyone can append it, and it selects wording, never a capability. The invalid/expired panel
still points at `/forgot-password`, and correctly — their account exists, so the ordinary reset flow
will mail them a fresh link with no staff involvement. Setting the password does not sign them in
(it's an anonymous token flow), so they land at `/login`, and their linked submissions are waiting at
`/account`.

### What survived the lockdown

`requireEmailVerification` stays **on**, and the #115 resend-verification affordance in
`LoginForm.svelte` stays with it: accounts that predate DAR-67 include self-registrants who never
clicked their link, who still 403 at sign-in and still need a way back in. The signup-panel variant of
that affordance went with the page. `emailVerification.sendOnSignUp` is now unreachable (there are no
sign-ups) and kept only so re-opening registration doesn't silently ship without it. The
`/sign-up/email` rate-limit rule is likewise kept: the limiter runs first, so it is what stops a script
hammering a permanently-400ing endpoint for free.

**Tests.** `auth.spec.ts` (the boundary + the surviving staff path + controls); `activation.spec.ts`
(mint here, redeem through better-auth's own `resetPassword`, prove the new password signs in — this
is the pin for the `reset-password:` prefix coupling, plus the no-password-account path production
actually uses); `activation-email.spec.ts` (that it is wired to its OWN copy family, that it doesn't
read as a password reset, and the seven-day expiry — the shared layout's mechanics live in
`link-email.spec.ts`); `waitlist-invite.spec.ts` × 2 (the derivation, and the UPDATE predicates);
`admin/waitlist/page.svelte.spec.ts` (badges, Invite-vs-Resend, outcome banners);
`signup/page.svelte.e2e.ts` (the notice renders, no form); and **`auth-api.e2e.ts`** — the boundary
against the deployed worker, `POST /api/auth/sign-up/email` → 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`.
**That last one is new (DAR-81)** and it is the acceptance criterion this ticket wanted and couldn't
write: the preview used to serve an origin `isAuthPath()` didn't recognise, so `/api/auth/*` 404'd
before any auth logic ran and the old assertion ("not ok, and no session") was satisfied by the 404
itself — it would have stayed green with registration re-opened. Both guards are kept: `auth.spec.ts`
says the CONFIG refuses public sign-up, `auth-api.e2e.ts` says the shipped worker does.

**The runtime path is `pnpm smoke:invite`** (DAR-80, `scripts/smoke-invite.ts` — see
[commands](commands.md#manual-smokes-not-in-ci)). Everything above tests a piece; the smoke tests them
in composition against a built preview, which is the only way to see `getAuth().$context` resolve
inside workerd, `createUser` succeed with no forwarded headers, `onPasswordReset` fire on a real
redemption, and the Resend send actually be awaited. It seeds a lead directly (the public form would
mail info@ and hit step 1's per-IP throttle), invites it, asserts the account is role `user`, verified,
**credential-less** and named from the earliest submission, reads the activation token out of
`verification`, checks it carries the week-long TTL, **follows the emailed link**, redeems it through
`/reset-password`, and asserts the credential now exists, the token is spent, `activated_at` is
stamped and the invitee signs in to `/account` (not `/admin`). Both refusals — `staff_account`,
`account_disabled` — are asserted to write **nothing**. It is hand-run, self-healing (it purges its
own leftovers before it starts, so a run that dies halfway doesn't change what the next one tests),
and it mails [`delivered@resend.dev`](https://resend.com/docs/dashboard/emails/send-test-emails),
Resend's test recipient: a real API call, visible in the Resend logs, landing in nobody's inbox.

**Following the link is DAR-91**, and it is what makes the callback in step 2 of the reset flow below
a tested hop rather than a documented one. The script still reconstructs the link itself (it cannot
read a mailbox) but takes everything after it off the response: the 302's `location` supplies the
path, the token and the `invite` flag, and the redeem POSTs there. Two assertions carry the weight,
because **the redirect is the same 302 whether the token is good or dead** — better-auth signals
failure with `?error=INVALID_TOKEN` on an otherwise identical response, so the query is checked, not
the status; and the landing page is matched on the form's **lede**, not its heading, since "Set your
password" is also the page `<title>` and therefore renders on the dead-link panel too. Both were
measured against the running preview, not reasoned about.

**Anti-enumeration is asserted on the wire** in the same script (also DAR-91):
`/request-password-reset` and `/send-verification-email` are each asked about an address that has an
account and one that cannot, and the two responses must match byte for byte. That claim previously
existed only as a unit test of `auth.api.*` return values — a claim about a function, not about what
a stranger with curl can see.

It lives in this script rather than `smoke:signin` because `/request-password-reset` **mails the
address it is asked about**, so the known-good half of each pair has to be able to _receive_.
`smoke:signin`'s two candidates both fail that: the operator's own address (a genuine reset link at a
colleague's inbox every run) and the throwaway operator it creates at `smoke-op-<ts>@example.com` —
example.com publishes a **null MX** (`0 .`, RFC 7505: accepts no mail), so that one would manufacture
a hard bounce per run on the same verified domain the site's real mail leaves from. Consequence worth
knowing: **a run now sends `SMOKE_INVITE_EMAIL` two emails**, the invitation and a real password
reset — fine for the `delivered@resend.dev` default, worth knowing before pointing the override at a
mailbox someone reads. The probes are anonymous by necessity: `/send-verification-email` takes a
completely different branch when a session cookie is present.

## Password reset (self-service)

Better Auth's built-in `forget-password` flow, wired to Resend and two form-action pages. **No schema
change** — the reset token lives in the existing `verification` table (identifier `reset-password:<token>`);
config is behavioral only, so it stays out of `auth-cli.ts`.

**Config** (`auth.ts`, augmenting the shared `emailAndPassword`): `sendResetPassword` renders + Resends
the link (`password-reset-email.ts`, DAR-181, sharing `link-email.ts` with the verification +
activation mail; graceful dev skip logs the link when there's no Resend key), `resetPasswordTokenExpiresIn: 3600`
(1 hour — the copy says so, and its spec pins that), and
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
flow is **no-JS friendly** and works for staff and end-users alike. Since DAR-67 it carries more weight
than its name suggests: invitations are password-reset tokens, so this is also how every NEW account
gets its first password. Disabling reset would disable onboarding.

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
- **First-admin provisioning** — `scripts/create-admin.ts` (`pnpm admin:create`). Public sign-up is
  closed and both staff paths need a signed-in admin, so this is still the **only** way to create the
  FIRST operator: it builds a throwaway Better Auth instance (same Turso DB + schema) and calls
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
  until promoted to `operator`/`admin`), matching `defaultRole: 'user'` (which since DAR-67 also covers
  the waitlist invite path — see "Invite-only onboarding"). The `/admin/users` page is worded as general **user** management, not
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
  admin op (it does not consult `disableSignUp`, which is what keeps account creation possible at all
  since DAR-67) and passes `data: { emailVerified: true }` so the vouched account can sign in
  immediately (#96 PR 2). Unlike the roster, DAR-67's invite calls it WITHOUT forwarding headers — a
  trusted server-side call, so operators can invite; the role is pinned to `user` there. Delete is
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
sign-up + email verification + Turnstile — since **closed again** by DAR-67, which replaced
self-registration with staff invitations (see "Invite-only onboarding" above). A
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

## What the limiter's 429 proves (DAR-92)

The DB-backed limiter is a real security control on the public auth surface, and until DAR-92 every
assertion about it was **config-level** — `auth.spec.ts` reads the options object and agrees with
itself. `auth-api.e2e.ts` now watches the deployed worker actually refuse: `max` requests inside the
cap answered by the endpoint, the next one answered by the limiter.

**Bucket isolation is the whole reason this was blocked, and the client-address header is the
answer.** The limiter keys each bucket `<ip>|<path>` (`createRateLimitKey`) and resolves the ip from
the header `advanced.ipAddress.ipAddressHeaders` names — `x-forwarded-for` when DAR-92 was written,
`cf-connecting-ip` since DAR-124 below — the same header the `/login`, `/forgot-password` and
`/reset-password` actions set from `getClientAddress()`. Nothing rewrites it between Playwright and a
local wrangler, so **a header the test chooses IS the bucket**. The probe imports `CLIENT_IP_HEADER`
rather than spelling it, so changing the config changes the test instead of stranding it on a header
nothing consults. Each probe therefore spends a private allowance:

- no rule ships that exists only for the tests, and no production limit changes (the ticket's
  options 1 and 2, both rejected);
- the DAR-67 boundary test stopped sharing a counter with anything — it used to spend one of the
  three sign-up attempts per hour that every anonymous caller shared, which made a CI **retry** for
  any unrelated reason land one step closer to a 429, and made the 4th run of an
  `E2E_REUSE_SERVER=1` loop fail outright;
- the addresses are drawn from **`2001:db8::/32`** (RFC 3849 documentation), randomised in the third
  and fourth groups because better-auth normalises IPv6 to its /64 before keying — 2^32 buckets, so a
  reused preview's hour-long counters can't hand a "fresh" probe a spent one.

**The count alone cannot identify which rule refused.** better-auth's built-in rule for `/sign-up*`
is `{ window: 10, max: 3 }` — the same `max` as ours — so "the 4th request 429s" holds just as well
against a config that has lost `customRules` entirely. Only the window separates them, and
`X-Retry-After` reports it; the test asserts it lands within a minute of `SIGN_UP_RULE.window`.
Mutating our rule's window to 10 is what proves that assertion is live.

**Isolation is asserted, not assumed.** After exhausting one probe's bucket the test sends a single
request from a second address and requires a 400. Without it, a run of that test alone against a
fresh preview would pass with the header doing nothing at all — and quietly break the two tests
above. Both mutations (a fixed address; the header removed) fail on exactly that line.

Three measured facts worth keeping:

- **The default rule is 100/10s**, so the ticket's "check whether the default is cheap enough to
  exhaust on an unused path" would have meant 101 requests — and would have asserted a better-auth
  default rather than a rule this repo ships.
- **The origin check runs after the limiter.** A request with no `Origin` is refused
  `403 MISSING_OR_NULL_ORIGIN`, and it has already spent its allowance by then.
- **A multi-token client-address header resolves to no ip at all.** With no `trustedProxies`
  configured, `getIPFromHeader` trusts a single-value header only, so a chain falls back to
  better-auth's shared `no-trusted-ip` bucket — one counter for every such caller. Preview logs say
  so out loud (`Rate limiting could not determine a client IP…`), which is what any `/api/auth/*`
  request without the header triggers. That is why the probe sends exactly one address.

What this still cannot cover: the **database** storage. A preview runs the limiter in memory
(`AUTH_RATE_LIMIT_STORAGE=memory`, DAR-81), so the counters these tests exhaust are per-isolate ones.
That the shipped `storage: 'database'` persists correctly stays a config-level claim.

## The bucket key is the edge's, not the caller's (DAR-124)

DAR-92's test proved the limiter refuses past its cap. Reading how it keys a bucket to write that
test surfaced the fact that the cap did not bind at all on the direct API, which is this ticket.

Better Auth resolves the client address from `advanced.ipAddress.ipAddressHeaders`, and its default
is **`x-forwarded-for`**. On a request that reaches a Worker that header is **whatever the caller
sent**: Cloudflare's proxy re-adds `X-Forwarded-For` with the visitor's address only _after_ all rule
phases, and Workers run before that
([Request Header Modification](https://developers.cloudflare.com/rules/transform/request-header-modification/)).
So on the direct `/api/auth/*` surface a caller picked its own rate-limit bucket, and
`login_audit.ip_address` recorded whatever address it claimed.

### Measured first, because the fix was worthless if the premise was wrong

Cloudflare's page establishes only that the edge has not added its own value by the time a Worker
runs; the step from there to "a caller's value survives ingress unmodified" is inference, and DAR-92
shipped two false claims about exactly this area that only measurement caught. **The limiter is its
own instrument**, so no echo endpoint was needed for the first half — against the deployed production
Worker:

| probe                                                 | result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| 4 × `POST /sign-up/email`, rotating `x-forwarded-for` | **all 400** — every rotation bought a fresh counter |
| 4 × the same, one fixed value (control)               | **4th = 429**, `x-retry-after: 3600`                |

The control is what makes it unambiguous: without it, "all four 400" reads the same whether the
caller chooses the bucket or the limiter is simply not running. The `3600` also identifies **our**
rule as the one enforcing, not better-auth's built-in 10-second one. And had Cloudflare stripped or
replaced the header, the first block's fourth request would have been the 429 instead.

The second half — is `cf-connecting-ip` actually unforgeable? — the limiter **cannot** answer, since
it does not read that header yet. A throwaway echo Worker deployed to the same account, hit, and
deleted answered it, and the result is stronger than "Cloudflare overwrites it":

| caller sends       | what the Worker sees                                             |
| ------------------ | ---------------------------------------------------------------- |
| `cf-connecting-ip` | **nothing — the request is refused at the edge, 403 error 1000** |
| `x-forwarded-for`  | the caller's value, **verbatim**                                 |
| `true-client-ip`   | the caller's value, **verbatim**                                 |
| `x-real-ip`        | **overwritten** with the real client address                     |

With no client-address headers sent at all, the Worker sees `cf-connecting-ip` = the real address and
`x-forwarded-for` = **absent**, exactly as the Cloudflare page describes.

The echo Worker served on **`workers.dev`**, which is not where the site serves, and the whole fix
rests on that first row — so it was re-confirmed against the **production custom domain**:
`GET https://darcstar.tech/` answers **403 error 1000** when the caller sends `cf-connecting-ip` and
**200** without it. The rejection is Cloudflare-wide, not a workers.dev quirk.

Two things fall out of that table. `true-client-ip` would have been **no fix at all** — it is an
Enterprise-only feature this plan does not have, so Cloudflare never sets it and a caller's value
sails through. And a request carrying `cf-connecting-ip` never reaching the Worker means **an e2e
probe shaped like ours only works against a local preview**: wrangler passes the header through,
Cloudflare's edge returns an error page. Worth knowing before anyone reaches for `signUpProbe` in a
smoke script.

### The fix, and the part that is not one line

`advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']` (`auth-options.ts`), which fixes the
limiter and `login_audit.ip_address` together — both go through the same `getIp`.

**No fallback entry.** `getIp` walks the list **in order** and takes the first that resolves, so
appending `x-forwarded-for` behind it would re-open the forgeable path in precisely the case that
matters: an environment where the trustworthy header went missing. One header means an unresolvable
address yields _no_ bucket key rather than a caller-chosen one. Measured: a local wrangler sets
`cf-connecting-ip: 127.0.0.1` itself when the caller sends none, so nothing needs the fallback.

**The form actions had to change with it, and that is where the real risk was.** `/login` (×2),
`/forgot-password` and `/reset-password` each built a sub-request carrying only `x-forwarded-for`, so
a `cf-connecting-ip`-only limiter would have read nothing from them and dropped **the one path that
was keyed correctly before this ticket** into the shared `no-trusted-ip` bucket — turning a per-IP cap
into a global one. A mismatch between "the header the config reads" and "the header the actions set"
produces no error of any kind; it just silently merges everybody's counters.

So the header is named **once** (`CLIENT_IP_HEADER`, beside the `ipAddressHeaders` that reads it) and
the sub-request is built **once** (`auth-subrequest.ts`), which also carries `getClientAddress()`'s
result back out — `/login`'s 429 branch writes its own audit row and needs the same address the
limiter just keyed on. An empty-string address now normalises to `null`: it used to reach
`login_audit.ip_address` as `''`, a row that reads like an address was captured when none was.

### What holds it, given nothing did before

The ticket's own note was that **no test asserted a form action forwards the client address at all**.
`auth-subrequest.spec.ts` is three layers, and the mutations that killed each are listed because a
guard nobody has attacked is a guess:

1. **The builder sets the header the config names** — read through the constant, never restated, so
   the two cannot drift while the test agrees with a stale copy. _(Builder set to `x-forwarded-for`
   → 2 red.)_
2. **Better Auth's own `getIp`, given the shipped options, ignores `x-forwarded-for`** — the
   behavioural claim, made against the real resolver rather than a re-implementation. Phrased as
   "never the caller's value" rather than "null", because `getIp` falls back to `127.0.0.1` under
   `isTest()`; asserting null would have been asserting the test environment. A separate assertion
   pins the list to exactly one entry, since the first can only see headers it thinks to send.
   _(Config reverted → 6 red across two specs; a fallback entry appended → 2 red.)_
3. **Two source rules, and they are an INVERSION.** Three cuts tried to IDENTIFY the callers of
   Better Auth's router by text and each was walked past by a spelling nobody had thought of:
   `auth.handler(` missed `auth.handler.bind(auth)`; widening to `auth.handler` missed
   `getAuth().handler(...)`, which is the most natural spelling of all since it needs no variable
   named `auth`. Both mutations passed **12/12 green** while hand-rolling `x-forwarded-for`.
   Deriving from `getAuth` importers is worse, not better — eleven files import it and most reach
   `auth.api.*`, which builds no sub-request and must not be forced through the builder. So the
   question "who calls the router?" is abandoned, because the fix does not actually need it:
   **only one file may NAME a client-address header** (an allowlist whose single entry is
   `auth-options.ts`, which defines the constant), and **no file may hand-build a request at an
   `/api/auth` path**. Neither cares what the auth instance is called, so no spelling escapes them.
   The allowlist is asserted with `toEqual`, so it fails in both directions — a new file naming a
   header, and an allowlisted file that STOPS naming one, which is how an allowlist decays into
   decoration (DAR-102's polarity). `auth-subrequest.ts` needs no exception: it takes the path as a
   parameter, so the `/api/auth` literal lives at the call sites and the `new Request(` lives in the
   builder, never both in one file. _(Mutations, all four caught on their intended rule:
   `getAuth().handler` + a header → 2 red; `auth.handler.bind` + a header → 2 red; a caller that
   forwards NOTHING, so there is no header literal to find → 1 red on the hand-built-request rule
   alone, which is what makes the pair non-redundant; the allowlisted file no longer naming a header
   → 1 red.)_ A third, positive assertion pins that the three actions which exist today import the
   builder — the two rules above are negative, and a negative rule over an empty set passes just as
   happily when the files it governs have been renamed away.

The e2e adds the end-to-end mirror of DAR-92's isolation test: one fixed client address, a **rotating
`x-forwarded-for` on every request**, and the cap must still bind at `max + 1`. Reverting the config
turns it red on exactly that line. Before this ticket it was a 400, because each rotation bought a
counter of its own and no number of requests ever reached the cap.

A **fourth** guard covers the half none of the others can reach. Every test above drives the direct
API, where the header arrives INBOUND; the form actions **construct** it on an in-process
sub-request, and layer 1 proves that under vitest — Node, with undici's `Headers`. The runtime is
workerd, and `cf-*` is exactly the family a runtime might treat specially, since Cloudflare's own
edge refuses an inbound request carrying `cf-connecting-ip`. So a form-action test drives
`/forgot-password` (its `/request-password-reset` cap is 3/hour, stated in our own config) through
the whole path — `getClientAddress` → `authSubrequest` → workerd `Headers` → `auth.handler` →
`getIp` → the bucket key — and requires that a **second address does not inherit** the exhausted
bucket. _(`authSubrequest` forwarding nothing → red on that line.)_ Two notes on it:

- **`accept: text/html` is load-bearing.** Without it SvelteKit answers a form-action POST with its
  `ActionResult` envelope — HTTP **200** carrying `{"type":"failure","status":429,…}` in the body —
  so `response.status()` reads 200 for a refusal, a success and a validation failure alike, and any
  assertion on it is satisfied by every outcome. With the header the request takes the genuine no-JS
  browser path, where the fail status IS the HTTP status. This is the repo's existing convention —
  `formPost` in `scripts/smoke-http.mjs` and the step POSTs in `scripts/smoke-waitlist.ts` both do
  it and say why.
- **The probe address must not resolve to a real account.** `/request-password-reset` MAILS a reset
  link when it does, and it is anti-enumerating, so the test cannot tell. CI is hermetic (the
  placeholder `DATABASE_URL` kills the lookup first), but a local `pnpm test:e2e` runs against the
  real dev DB with a real Resend key.

**Not covered:** the production edge behaviour of the deployed fix. The e2e runs against a local
wrangler, which has no Cloudflare ingress — so "the deployed Worker now keys on an address the caller
cannot choose" rests on the measured edge facts above plus the local behavioural test, and is
confirmed by re-running the Step 0 probe against prod after the deploy (the rotating-header block
must then trip the cap at its fourth request).

## Every form action is its own authorization boundary (DAR-226)

**SvelteKit does not run a layout `load` guard before a form action** — only on the re-render
afterwards. So `admin/+layout.server.ts`, `admin/users/+layout.server.ts` and
`account/+layout.server.ts` protect page **loads** and nothing else, and the gate written into each
action's first few lines is the entire boundary for every POST.

DAR-140 established that and **measured** what a missing one looks like from outside: an anonymous
POST at a real lead answered `303 → /login` **and wrote the row**. The redirect is emitted by the
re-render, so a refused action and an ungated one produce the same response — a signed-in end-user
gets the same shape, `303 → /account`. Nothing about the wire can tell them apart, which is why this
is a test's job rather than a review's. It covered `/admin/waitlist`; DAR-226 covers the other four.

| Route              | Actions | Gate                          | Spec                                 |
| ------------------ | ------- | ----------------------------- | ------------------------------------ |
| `admin`            | 1       | `isStaff`                     | `admin/page.server.spec.ts`          |
| `admin/users`      | 1       | `rosterAdmin`                 | `admin/users/page.server.spec.ts`    |
| `admin/users/[id]` | 7       | `rosterAdmin` + `guardTarget` | `.../[id]/page.server.spec.ts`       |
| `admin/waitlist`   | 7       | `isStaff` / `isRosterAdmin`   | `admin/waitlist/page.server.spec.ts` |
| `account`          | 2       | `locals.user`                 | `account/page.server.spec.ts`        |

**Assert the pair, never the refusal alone.** A one-sided test passes against a build that locked
everyone out, and an admission-only test passes against one with no gate at all. Each route's pair is
chosen so the actor that discriminates is the one asserted:

- `/admin` — an **operator must be admitted**. Message triage is the operator role; tightening this
  to `isRosterAdmin` (the predicate its sibling correctly uses, one identifier away) leaves operators
  looking at every message behind a delete button that silently 403s.
- `/admin/users` and `/admin/users/[id]` — an **operator must be refused**. An operator who could
  mint accounts could mint an `admin` one.
- `/account` — an **end-user must be admitted**, which runs the opposite way from everything else
  here: `user` is exactly the role `/admin` bounces, and this is where it bounces them to.

An end-user and an anonymous caller fail every one of these predicates, so they cannot tell them
apart; only the operator (or, for `/account`, the end-user) row can.

**`guardTarget` is asserted by position**, not just by outcome: the refusal must land before the
better-auth call, and — for the two actions with a later validation of their own — before that too.
The two actions that deliberately **skip** it are asserted in the other direction, because adding the
guard there reads like hardening and removes a capability: `updateDetails` is how an admin corrects
their own sign-in email, and `enable` is the only way back for an owner disabled through the raw
admin API, where the owner concept does not exist.

**A scan covers the nineteenth action**, since the specs above can only speak for the eighteen that
exist and nothing makes a new one inherit a gate. `form-action-gate.spec.ts` derives the protected
subtrees from the layout guards themselves — a `['admin', 'account']` list would be a scan list,
whose polarity is backwards (DAR-99 measured a drifted file passing 7/7 after one entry was deleted)
— then requires every action, **per action and not per file**, to name a gate and refuse with
401/403 before its first `await`.

The two layers catch different defects, measured on one action rather than argued:

| mutation                                                  | scan | behavioural spec |
| --------------------------------------------------------- | ---- | ---------------- |
| gate deleted outright                                     | 🔴 1 | 🔴 6             |
| gate replaced by `locals.user!` (names it, binds nothing) | 🟢 0 | 🔴 4             |
| `rosterAdmin` swapped for `isStaff`                       | 🟢 0 | 🔴 2             |

The middle row is the honest residual — this rule reads whether a gate is **named**, never whether it
**binds**. The bottom row is a division of labour rather than a hole: which of four predicates is
correct for a given route is a judgement no scan can hold.

## Still deferred

Pagination for the submissions **and roster** lists (both capped at 200, newest-first); GitHub OAuth
is configured in the CLI but not enabled in `auth.ts`; owner-vs-admin protection at the endpoint level
(a promoted admin can still target an owner via the raw admin API) is out of scope — admins are
trusted; see "User management". Sign-up UI copy is untranslated, like every other `es` string —
`es.json` holds translated keys only, so it falls back to `en` (#18, DAR-53); email-change
self-service in `/account` stays deferred (email is the sign-in + backfill key).
