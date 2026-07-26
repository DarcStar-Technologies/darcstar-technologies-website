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

Routing is server-side: the step-2 response carries `next` (`'step3'`, `'step4a'`, `'step4b'` or
`'done'`), computed by `waitlist-flow.ts` from the answers just submitted — see **The routing rules**
below. Non-commercial visitors skip step 3 and fork straight to a step-4 branch.

## Step 3 — commercial context (live)

Shown only to **commercial/operational** use cases (DAR-62): four optional questions — **current
approach**, **economic impact**, **realistic budget** (single-selects) and **adoption requirement** (a
multi-select capped at `WAITLIST_EVIDENCE_MAX`) — plus the same Continue / Skip pair. Each carries the
survey question as `help` text (GlassSelect / GlassCheckboxGroup wire it as `aria-describedby`, so the
question is a description, not part of the control's accessible name). `WaitlistStep3.svelte` owns the
form, `submitWaitlistStep3` (`waitlist-steps.remote.ts`) the write; slugs in
`waitlist-qualification.ts`, labels in `waitlist-{approach,impact,budget,evidence}-labels.ts`. The
impact/budget answers are internal-only — never displayed back or emailed to the respondent, and never
described as pipeline.

## Step 4 — intent branches (live)

The flow forks (DAR-63). Branch **A** (`WaitlistStep4A.svelte` → `submitWaitlistStep4A`) is for
active commercial interest: one always-asked question (would you consider a paid evaluation or
pilot?) and, **only for a positive answer**, a revealed block — deployment scale (free text, capped
at `WAITLIST_DEPLOYMENT_SCALE_MAX`), contact permission, preferred contact method, and a phone field
nested behind choosing a call. Branch **B** (`WaitlistStep4B.svelte` → `submitWaitlistStep4B`) is for
research/general interest: one uncapped multi-select of what to send, and **nothing** about budgets,
pilots or contact permission. Labels live in `waitlist-{pilot-interest,contact-method,research-preference}-labels.ts`.

- **The reveals are progressive enhancement, never a gate.** `mounted` is false during SSR and until
  hydration, so a no-JS visitor gets every field rendered and submittable (all optional); JS only
  collapses what isn't relevant, and it uses `{#if}` so a stale phone number can't ride along after
  the answer changes. The server decides what's stored either way — `contact_permission` is emitted
  as `null` ("never asked") unless the pilot answer is positive, on the **same**
  `isPositivePilotInterest` predicate the component reveals on, so UI and storage can't drift.
- **Step-4A's free text is internal-only** — `deployment_scale` is never echoed to the submitter (the
  ack email builder takes `CleanedWaitlist`, which is step-1 fields only; pinned in
  `waitlist-notify.spec.ts`) and must stay out of DAR-66's analytics events.
- **Branch B preferences are not consent.** `consent_updates` (step 1) governs whether we may write
  at all, and is itself an unverified single-opt-in claim.

## The routing rules (`src/lib/server/waitlist-flow.ts`)

Every routing decision is implemented ONCE here — the step endpoints and DAR-65's classifier reuse
these rather than restating them:

- `isCommercialUseCase({ role, primaryApplication })` — DAR-62's exclusions (`researcher` /
  `student` / `investor-advisor`, or a `research-education` application route past step 3) **plus
  fail-safe polarity**: commercial needs a POSITIVE signal, so an unanswered (or unrecognized) role
  AND application reads as non-commercial rather than as a prospect. That matches the epic's polarity
  for the step-4 fork ("everything else, incl. unanswered → branch B") and keeps money questions away
  from anyone we can't classify. One answered, non-excluded field is signal enough.
- `canonicalizeWaitlistRole` — `role` holds both slug sets, so it maps v1 → v2 first; a legacy
  `research` row would otherwise read as "not a researcher" and get asked about budget.
- `step4BranchFor(evaluationTimeline)` — DAR-63's fork: `evaluating-now` / `within-3-months` /
  `3-12-months` → **A**, everything else (incl. unanswered, unrecognized) → **B**, the branch that
  asks nothing sensitive. Keyed on the timeline ALONE — role/application gate step 3, not this fork,
  so a researcher who is evaluating now still gets asked branch A's question.
- It lives under **`$lib/server`** on purpose: the decision must never be client-authoritative, and
  the import guard makes that structural (a component physically cannot import it). The browser learns
  the next step only from a step response's `next`.
- **Not an authorization boundary.** Which step you're shown is UX, not permission: a crafted POST
  straight to `submitWaitlistStep3` — or to the branch you weren't routed to — still gets validated +
  stored (token permitting), because answering buys no privilege; the classifier judges the submitter
  by their answers either way. Re-checking a routing predicate at the write would only add a way to
  lose data. The one exception is step 4A's `contact_permission`, gated at the validator so a grant
  can only be recorded from a question that was actually on screen.

### The branch claim — why step 3 doesn't read the row

The fork reads `evaluation_timeline`, answered at **step 2** — but a commercial visitor passes
through step 3, whose form doesn't re-ask it. Recovering it by **reading the stored row was
rejected**: `next` would then depend on stored state, and the continuation token deliberately reaches
any submitter of a known email, so a `next: 'step4a'` would prove "this address is on the list, with a
near-term timeline" to anyone who guesses it. Instead step 2 **signs** the decided branch
(`mintWaitlistBranchClaim` — its own domain + `b1` prefix over the same secret, so it can never be
confused with a continuation token) and returns it as `branchClaim`; step 3's form carries it as a
hidden field and the endpoint verifies it. The MAC is what makes the hidden field safe — nobody can
edit their way into branch A's contact-collection — and because the claim is minted from answers the
visitor just submitted, it tells its holder nothing they didn't already know. It is **not** bound to
the row id: it authorizes no write, it only chooses which questions render.

### Two mechanics the later steps inherit

- **The token echo.** Each step response returns the submitted `token` verbatim (capped, never
  re-minted) so the NEXT step's hidden field survives a no-JS re-render — after a native per-step POST
  the step-1 result is gone. Reflecting the caller's own input hands out nothing new.
- **Best-effort enrich** (`applyStepBestEffort`). The row persisted at step 1 and these steps are
  optional enrichment, so a DB failure logs and moves on instead of erroring the visitor's flow — the
  same posture as the fire-and-forget notification emails. A verification failure is silent for the
  anti-oracle reason. It also **skips the write for a decoy id** (`isDecoyWaitlistId`, whose shape
  lives with `mintDecoyWaitlistToken`): the honeypot's token addresses no real row, so the UPDATE
  could only ever match zero rows — a trap-tripping bot shouldn't get to spend DB writes. Nothing
  observable changes (the response is generic either way), and it's what keeps the step e2e specs
  DB-free even on the answered paths.

## v2 progressive qualification flow (DAR-58)

The single form is being replaced by a short progressive flow (step 1 secures the signup; steps 2–4
gather qualification data from people willing to continue). **DAR-59 shipped the data-model
foundation** (schema columns, validators, store step-path, continuation token); **DAR-60 shipped
step 1** (the core signup above), **DAR-61 step 2** (use-case questions), **DAR-62 step 3**
(commercial context + the server-side flow gate) and **DAR-63 step 4** (the A/B intent branches) —
see the sections above. The flow is now complete end to end; the classifier + admin view land in
DAR-65, funnel analytics in DAR-66.

### Qualification columns

The `waitlist` table grew nullable columns for steps 1–4 (country/consent, application/role/timeline,
approach/impact/budget/evidence, pilot details, research prefs). Slug values are validated against
`$lib/waitlist-qualification.ts` (the single client-safe source shared by the step forms and the
server validators). Two multi-selects (`adoption_evidence`, `research_preferences`) store JSON string
arrays. `role` is shared between v1 and v2 slug sets — legacy v1 slugs remain as history, new writes
use the v2 set; **a consumer that branches on `role` must canonicalize v1→v2 first**
(`canonicalizeWaitlistRole`, in `waitlist-flow.ts`).

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
predicate, `isPositivePilotInterest`, that `WaitlistStep4A` reveals the checkbox on), and the store
keep-existings a `null` — so a not-shown submit can't silently revoke a standing grant.

Like `consent_updates`, it is an **unverified claim**: the row is identified only by a continuation
token, which the anti-enumeration success shape hands to _any_ submitter of a known email. So a third
party who guesses an address on the list can set (or overwrite) that row's `contact_permission`,
`phone` and `pilot_interest` — the same provided-wins exposure every qualification column has under
`keepExisting`. Treat step 4A's contact block as a lead-qualification hint, **not** proof that this
person asked to be called, and confirm by replying to the signed-up address before acting on it.

### Wire contract for the step forms

A multi-select checkbox group **must** be named `foo[]`, not `foo` (step 3's `adoptionEvidence[]` and
step 4B's `researchPreferences[]` are the live examples — `GlassCheckboxGroup` gets the suffix from
Kit's `.as('checkbox', value)`). SvelteKit's form-data conversion
throws on a repeated plain name ("Form cannot contain duplicated keys"); only the `[]` suffix yields
an array (arriving under key `foo`, always `string[]`; zero checks omit the key). Single checkboxes
(consent, contact permission) are read by presence — any non-empty value is `true` — so the markup
can carry a `value=` attribute without silently dropping the opt-in.

## Admin

`/admin/waitlist` is the staff triage view (gated by the `/admin` layout). Its `role` column now
resolves both the v1 and v2 label sets (DAR-61 writes v2 role slugs into that shared column, so the
roster shows the localized label, not the raw slug); the remaining qualification columns,
classification, and consent visibility land in DAR-65.

## Setup

`RESEND_API_KEY` (shared with contact) powers the emails; `BETTER_AUTH_SECRET` (already provisioned
for auth) signs the continuation token. No new secret. Schema changes follow the usual
`pnpm db:generate` + committed `drizzle/` migration (drizzle CI gate).
