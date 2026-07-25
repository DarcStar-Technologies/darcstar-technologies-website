# Waitlist — early-access lead capture (+ v2 qualification flow)

`/waitlist` captures early-access signups: a lighter-touch sibling of the contact form. Same shell
(CosmicBackdrop + centred `glass-card`, indexable). It submits through a SvelteKit **remote `form`**
(`src/lib/waitlist.remote.ts`, `joinWaitlist`) so it progressively enhances with JS and degrades to
a native POST without.

Everything lives under `src/lib/waitlist*.ts` (client-safe slug lists + labels), `src/lib/server/
waitlist*.ts` (validators, store, token, notify), the `waitlist` table (`db/schema.ts`), and the
`/waitlist` + `/admin/waitlist` routes.

## Step 1 — the core signup (live)

`/waitlist` is the v2 step-1 core signup (DAR-60): **Name + Email are required**; Organization
(`company`), Country/region (a `GlassSelect` over `WAITLIST_REGIONS` → `waitlist-region-labels.ts`),
and an unchecked marketing-consent checkbox (`consent_updates`) are optional. Submit persists the row
immediately, so abandoning the later qualification steps still retains the signup. It remains the one
indexable entry to the flow. (The v1 form asked for email only behind a `<details>` enrichment
disclosure; DAR-60 flattened it — role moved to step 2, phone to step 4A, and company-size / interest
/ hear-about left the UI, their columns retained per DAR-59. The interest free-text datalist and its
`+page.server.ts` load were retired with it, so the page now has no server load.) Safety rails,
unchanged since v1:

- **Honeypot** `website` field — a non-empty value is silently accepted (never persisted, trap not
  revealed).
- **IP/time throttle** — at most 5 signups per hashed IP per hour (`hashIp`, the same truncated
  SHA-256 as the contact form; the raw IP is never stored).
- **Insert-or-enrich** on `lower(email)` (unique index) via `upsertWaitlist` — a re-signup enriches
  the existing row **fill-forward** (`fillIfEmpty`: fills a still-null column, never overwrites a
  stored value) rather than piling up duplicates. Step 1 is unauthenticated, so this stops a stranger
  who knows an existing email from clobbering its name/company/region on a (throttle-exempt) resubmit;
  the token-gated qualification steps keep provided-wins (`keepExisting`) since holding the token is
  the authorization. It returns `isNew` (a genuine first signup) and the row `id`.
- **Emails gated on `isNew`** — a lead → `info@` and a localized signer ack, fire-and-forget via
  `ctx.waitUntil`. Gating on `isNew` is the anti-abuse boundary: same-email replays enrich (add no
  row), so without the gate the ack would be an unthrottled mailbomb.
- **Anti-enumeration** — new vs. existing email return the identical success shape.

## Step 2 — use-case questions (live)

After a successful signup the page swaps step 2 (DAR-61) into the same glass-card: three optional
single-selects — **primary application**, **your role** (the v2 `WAITLIST_V2_ROLES` set written to
the existing `role` column), and **evaluation timeline** — plus **Continue** / **Skip for now**.
Slugs live in `waitlist-qualification.ts`; labels in `waitlist-application-labels.ts`,
`waitlist-v2-role-labels.ts`, and `waitlist-timeline-labels.ts` (the v2 role labels are DISTINCT from
the v1 `waitlist-role-labels.ts`, whose slugs survive only as stored history). `WaitlistStep2.svelte`
owns the form; `+page.svelte` owns the step state machine (step-1 success → step 2 →
confirmation — it checks the step-2 result FIRST, since on the JS path the step-1 result is still
truthy).

The write is `submitWaitlistStep2` (`waitlist-steps.remote.ts`, its own remote `form` — enhances
with JS, degrades to a native per-step POST). It carries step 1's **continuation token** as a hidden
field and enriches via `applyWaitlistStep` (per-step column map, keep-existing). Rules:

- **Anti-oracle** — every path returns the identical `{ success: true }`. A bad/expired/decoy
  token, a row that no longer exists, and a real write are indistinguishable, matching the token
  layer's generic-null contract. Continue never surfaces a field error (an unknown slug coerces to
  null, never rejects).
- **Skip and empty Continue write nothing** — Skip must not persist partial junk, and an all-blank
  Continue has nothing to enrich, so both short-circuit _before any DB round-trip_ (which is also what
  keeps the step-2 e2e hermetic against the placeholder DB — it reaches step 2 via the honeypot's
  decoy token, then skips / empty-continues with no query).
- **Continue is first in the DOM** so it's the default submitter — pressing Enter continues, it
  never accidentally skips.

Routing (Continue → step 3 when the answers qualify as commercial/operational, else a step-4
branch/confirmation) is defined server-side in the step-3 issue (DAR-62) and plugs into the
`submitWaitlistStep2` seam; today both Continue and Skip terminate at the confirmation.

## v2 progressive qualification flow (DAR-58)

The single form is being replaced by a short progressive flow (step 1 secures the signup; steps 2–4
gather qualification data from people willing to continue). **DAR-59 shipped the data-model
foundation** (schema columns, validators, store step-path, continuation token) and **DAR-60 shipped
step 1** (the core signup above) and **DAR-61 shipped step 2** (the use-case questions — see
`## Step 2` above). Steps 3–4's UIs + endpoints land in DAR-62/63; the classifier + admin view in
DAR-65; funnel analytics in DAR-66.

### Qualification columns

The `waitlist` table grew nullable columns for steps 1–4 (country/consent, application/role/timeline,
approach/impact/budget/evidence, pilot details, research prefs). Slug values are validated against
`$lib/waitlist-qualification.ts` (the single client-safe source shared by the step forms and the
server validators). Two multi-selects (`adoption_evidence`, `research_preferences`) store JSON string
arrays. `role` is shared between v1 and v2 slug sets — legacy v1 slugs remain as history, new writes
use the v2 set; **a consumer that branches on `role` must canonicalize v1→v2 first** (a shared helper
is expected before DAR-65's classifier lands).

`qualification_step` is a monotonic integer high-water mark (1 = signup … 4 = a branch). Which
step-4 **branch** completed is NOT stored — derive it from the branch-specific columns
(`pilot_interest` set → branch A; `research_preferences` set → branch B), so DAR-65/66 need no extra
column and no backfill.

### Continuation token (`waitlist-token.ts`)

Steps 2–4 are **unauthenticated** writes that enrich the row step 1 created, so step 1's response
carries a signed, expiring token; each later step submits it back and the server verifies before
updating. `v1.<rowId>.<exp>.<mac>` — HMAC-SHA-256, 24h TTL, over **`BETTER_AUTH_SECRET`** (reused,
not a new secret; the `darcstar:waitlist-continuation:v1` domain prefix separates these MACs from
anything Better Auth signs). Guarantees, all unit-pinned:

- A raw row id is never accepted; the MAC binds id **and** exp (no swap/extend).
- Verification failure is a generic `null` — callers respond identically for bad-token / row-gone,
  so the token layer isn't a row/email-enumeration oracle.
- Tokens are **canonical**: one `(id, exp)` → exactly one valid string (exp has no leading zeros; the
  decoded MAC must re-encode to the received bytes). This isn't a capability boundary today — it
  keeps a future exact-string dedup/blocklist from being bypassed by equivalent token strings.

**The token is returned to ANY submitter of an existing email** (the anti-enumeration success shape),
so it authorizes writing that row's qualification columns to whoever holds it. This is a larger
surface than v1's enrich-by-email. The step writes are built to stay safe under that exposure:
`applyWaitlistStep` uses an explicit **per-step column map** (mass-assignment guard — a step can only
write its own columns, never identity, never another step's answers), and per-field keep-existing
rules bound what a holder can change. **A step endpoint must not add an absolute overwrite of a
sensitive field.** (The honeypot path returns a _decoy_ token — deterministic per email, addressing
no real row — so the response body matches a real success; a timing side-channel still distinguishes
the trap, which is accepted.)

### Consent

`consent_updates` is an **unverified single-opt-in claim** — the form is unauthenticated, so a third
party can set it for any address. It's monotonic (an unchecked re-submit is "no new grant", never a
silent revocation; revocation is a future unsubscribe mechanism) and stamped with `consent_updates_at`
on first grant (provenance). **It must not drive a real send without double-opt-in + unsubscribe.**

### `contact_permission` is tri-state

`null` = the question wasn't shown (pilot interest not positive), `false` = shown and declined,
`true` = granted. The step-4A validator emits `null` unless the pilot answer is positive (the same
predicate, `isPositivePilotInterest`, that DAR-63 gates the checkbox's rendering on), and the store
keep-existings a `null` — so a not-shown submit can't silently revoke a standing grant.

### Wire contract for the step forms (DAR-62/63)

A multi-select checkbox group **must** be named `foo[]`, not `foo`. SvelteKit's form-data conversion
throws on a repeated plain name ("Form cannot contain duplicated keys"); only the `[]` suffix yields
an array (arriving under key `foo`, always `string[]`; zero checks omit the key). Single checkboxes
(consent, contact permission) are read by presence — any non-empty value is `true` — so the markup
can carry a `value=` attribute without silently dropping the opt-in.

## Admin

`/admin/waitlist` is the staff triage view (gated by the `/admin` layout). Its column projection is
v1-only today; DAR-65 adds the qualification columns, classification, and consent visibility.

## Setup

`RESEND_API_KEY` (shared with contact) powers the emails; `BETTER_AUTH_SECRET` (already provisioned
for auth) signs the continuation token. No new secret. Schema changes follow the usual
`pnpm db:generate` + committed `drizzle/` migration (drizzle CI gate).
