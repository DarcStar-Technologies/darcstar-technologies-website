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
(`company`), Country/region (a `GlassSelect` over `WAITLIST_REGIONS` → `waitlist-labels.ts`),
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
Slugs live in `waitlist-qualification.ts`, labels in `waitlist-labels.ts` (the v2 role labels are
DISTINCT from the v1 `waitlistRoleLabel` in the same module, whose slugs survive only as stored
history; `toOptions` there pairs a slug list with its label map for the selects).
`WaitlistStep2.svelte` owns the form; `+page.svelte` owns the step state machine (step-1 success → step 2 →
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
  decoy token, then skips / empty-continues with no query). "Has an answer" is
  `hasAnyAnswer(cleaned)` — a generic `some(v => v !== null)` over the validator's output rather than
  a per-step list of fields, so a new column can't be left out of it and silently stop persisting.
- **Continue is first in the DOM** so it's the default submitter — pressing Enter continues, it
  never accidentally skips. Both buttons live in `WaitlistStepActions.svelte`, shared by all four
  steps, so that ordering has one home.

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
`waitlist-qualification.ts`, labels in `waitlist-labels.ts`. The impact/budget answers are internal-only — never displayed back or emailed to the respondent, and never
described as pipeline.

## Step 4 — intent branches (live)

The flow forks (DAR-63). Branch **A** (`WaitlistStep4A.svelte` → `submitWaitlistStep4A`) is for
active commercial interest: one always-asked question (would you consider a paid evaluation or
pilot?) and, **only for a positive answer**, a revealed block — deployment scale (free text, capped
at `WAITLIST_DEPLOYMENT_SCALE_MAX`), contact permission, preferred contact method, and a phone field
nested behind choosing a call. Branch **B** (`WaitlistStep4B.svelte` → `submitWaitlistStep4B`) is for
research/general interest: one uncapped multi-select of what to send, and **nothing** about budgets,
pilots or contact permission. Labels live in `waitlist-labels.ts` like every other step's.

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

## The confirmation — one personalized CTA (live)

Every path ends on `WaitlistConfirmation.svelte` (DAR-64): the full flow, a Skip at any step, and
both step-4 branches. It reuses the shared `ContactSuccess` shell (check badge + title/body) and adds
**exactly one** call to action, chosen from four:

| Audience                                   | CTA                                | Target                                  |
| ------------------------------------------ | ---------------------------------- | --------------------------------------- |
| Strong pilot prospect (positive 4A pilot)  | Request an evaluation conversation | `/contact`, upgraded to the modal by JS |
| Technical evaluator (commercial, no pilot) | View the GIDE evidence overview    | `/evidence`                             |
| Researcher / education (or investor)       | Explore technical publications     | `/research`                             |
| General signup (nothing classifiable)      | Return to DarcStar                 | `/`                                     |

- **The variant is a SERVER decision.** `confirmationCtaFor` (`waitlist-flow.ts`) picks it from the
  same flow state that routes the steps, and the terminal step's response carries the resolved value
  as `cta`; the component receives a bare slug and only maps it to a label + href. Nothing is
  re-derived from form values in the browser.
- **Ordered by the strongest signal**, with fail-safe polarity at the bottom: a positive pilot answer
  outranks any audience (and is the ONLY route to the conversation CTA — branch B can't reach it,
  because it never asks the question), and an unknown audience gets `home`, which commits to nothing.
  A **Skip** is treated as "we learned nothing" for the step it skipped: skipping step 2 → `home`;
  skipping step 3 or 4 keeps the audience step 2 established, since a skip persists nothing but
  doesn't retract what was already answered.
- **Nothing the visitor answered is echoed back.** The screen is fixed copy plus a link, so the
  internal-only value/budget/deployment answers have no path to it — asserted in the e2e, which fails
  on a currency figure or a budget/impact/deployment label anywhere in the confirmation.
- **No-JS**: all four variants are real `<a href>`s. The pilot one is genuinely a `/contact` link;
  with JS a click handler opens the site-wide `contactDialog` in place instead (modifier and
  non-primary clicks are left alone so "open in a new tab" still works), and `aria-haspopup="dialog"`
  is `mounted`-gated so the ARIA promise is only made once it's true.
- The epic's `evaluation_conversation_requested` **analytics event is not fired** — the site has no
  analytics transport yet. Its call site is marked in `WaitlistConfirmation.svelte`; **DAR-66** owns
  it.

## Internal lead classification (live)

`classifyWaitlistLead` (`src/lib/server/waitlist-classify.ts`) reduces the qualification answers to
one triage bucket for `/admin/waitlist` (DAR-65). Listed here in the order the checks RUN, which is
deliberately not the order they sort in — `WAITLIST_LEAD_CLASSES` holds the triage order (A, B, C,
research, investor) and its index is the rank:

| Class        | Wins when                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `investor`   | an `investor-advisor` role — checked FIRST, so an investor is never scored as a customer       |
| `research`   | anything non-commercial (`audienceFor` ≠ `commercial`): researchers, students, general signups |
| `priority-a` | all three of: immediate timeline (≤3 months), authority role, POSITIVE pilot interest          |
| `priority-b` | commercial, still inside the 12-month window                                                   |
| `priority-c` | longer-term commercial interest — over 12 months, general interest, or no timeline given       |

- **The money guardrail is the shape of the input type.** `economic_impact` and `budget_range` are
  absent from `WaitlistLeadSignals`, so the rubric _cannot_ score on a self-reported dollar figure —
  a $25k prospect with a real system, real authority and a three-month timeline outranks an anonymous
  ">$1M", and that ordering is unit-pinned. The figures stay visible on the admin row detail, where
  judgement (not arithmetic) weighs them.
- **Internal only.** Never rendered on a public page, never emailed to the person classified, never
  described as committed pipeline. Living under `$lib/server` makes the first of those structural (a
  public component physically cannot import it); the admin page carries the other two as standing
  notes above the fold. Only the slug VOCABULARY (`WAITLIST_LEAD_CLASSES`, in
  `waitlist-qualification.ts`, in triage order so its index IS the rank) is client-safe, because the
  badge needs a localized label — the same split DAR-64's CTA uses.
- **Computed on read, never stored.** Every input is a column the flow already persists, so a
  denormalized copy would buy a migration, a backfill and a recompute obligation on every step write.
  A rubric change takes effect on the next page view with no rows to migrate.
- **It reuses the flow rules rather than restating them** (`audienceFor`,
  `canonicalizeWaitlistRole`, `isActiveEvaluationTimeline`) — a rubric that drifted from the flow
  would classify people by questions they were never asked. Fail-safe polarity carries through:
  nobody is promoted by silence, so an empty row lands in `research`, not a priority band.
- **The step-1 lead email was deliberately left alone.** DAR-65 offered a second internal
  notification when a signup completes qualification as Priority A; it is **not** built here. The
  rubric's three signals can only all be present at a **step-4A** submit, and step 4A is authorized
  by the continuation token — which the anti-enumeration success shape hands to _any_ submitter of a
  known email. So a stranger who guesses an address on the list could drive unlimited "Priority A!"
  mail into `info@`: exactly the mailbomb the `isNew` gate exists to close, and closing it again
  needs a null→positive transition guard the current `keepExisting` UPDATE doesn't report. That is
  its own ticket, not a rider on the classifier.

## Funnel analytics (live)

**DAR-66.** The site had no analytics at all, so this is first-party and deliberately small: a
`waitlist_funnel_event` row is `(flow_id, event, created_at)` and nothing else. Slugs and the two
write guards are client-safe (`$lib/waitlist-funnel.ts`); the write path and the readout are
server-only (`$lib/server/waitlist-funnel.ts`).

**No third party, and no new CSP origin.** A hosted script would need a `vite.config.ts` allowlist
entry plus a synthetic probe (see [security-headers](security-headers.md)), would ship an identifier
to someone else's server, and would be blocked for a good share of exactly this audience. The one
client-fired event goes through a SvelteKit remote **`command`** — same-origin, already covered by
`connect-src 'self'`.

### The flow id

A random UUID minted per render by `/waitlist`'s `+page.server.ts` load, carried through the flow in
a hidden field. It is **not** the waitlist row id and **not** derived from the email — an analytics
row must not be walkable back to a person, and a derived id would be joinable to `waitlist` by anyone
who could recompute it. It is shape-checked on write (`isWaitlistFlowId`), so the column can only ever
hold UUIDs, and each step **echoes it verbatim** exactly as it echoes the continuation token: without
JS every step is a native POST that re-renders the page, whose load mints a fresh id, so an unechoed
handle would split one visitor across four flows.

### The events

`waitlist_viewed` (a GET of the page) · `waitlist_signup_completed` (step 1 accepted) ·
`qualification_started` (step 2 submitted, either button) · `use_case_completed` (step 2 answered) ·
`commercial_context_completed` (step 3 answered) · `pilot_interest_selected` (step 4A answered, any
answer) · `qualification_completed` (the confirmation reached, from any step) ·
`evaluation_conversation_requested` (the pilot CTA activated).

`qualification_started` vs `use_case_completed` is the useful pair: a Skip fires the first and not the
second. And because step-1 success **always** shows step 2, the gap between
`waitlist_signup_completed` and `qualification_started` is precisely the people who saw the questions
and closed the tab.

### Four decisions worth keeping

1. **The view event rides a GET, not `navigator.sendBeacon`.** The ticket sketched a beacon to a small
   endpoint; capturing it in the load instead means no second public write endpoint to abuse-proof, no
   view lost to a blocker or a bounce before hydration, and the no-JS visitor counted like everyone
   else — which matters when the primary metric's denominator is "people who saw the form". It is
   guarded on `request.method === 'GET'`, because Kit re-runs loads when it re-renders the page after
   a native step POST (`render_page` → `handle_remote_form_post` → loads, same request) and counting
   those would inflate the denominator by one view per step, for exactly the visitors least able to
   convert.
2. **The per-flow cap is the composite primary key.** `(flow_id, event)` + `onConflictDoNothing()`
   bounds a flow to one row per event in the same statement as the insert — no counting query — so a
   replay, a double-click or a bot re-POSTing a step is a no-op. It also makes every count a count of
   **distinct flows**, which is what turns signups/views into a conversion rate rather than a ratio of
   retries.
3. **The privacy rule is the table's shape.** There is no column for an IP, a user agent, an email, a
   row id or any answer text, so a future writer cannot quietly start recording one; the free-text
   answers (deployment scale, the money questions) are internal-only by DAR-58 and have nowhere to
   land. A unit spec asserts the column list, so adding one is a failing test, not a code review.
4. **Client-fired events are allowlisted separately.** `recordWaitlistFunnelEvent` accepts only
   `CLIENT_FIREABLE_FUNNEL_EVENTS` — today just `evaluation_conversation_requested`, the one funnel
   moment with no server request of its own — not the full vocabulary. It's the same mass-assignment
   guard `applyWaitlistStep` puts on columns: being able to POST `qualification_completed` would mean
   being able to inflate the numbers this exists to report. What remains, and is accepted, is that a
   script can mint fresh flow ids and add a row each time — true of any anonymous counter, including
   the view GET, which is why the readout is labelled directional.

### Failure is silent, everywhere

`captureWaitlistFunnel` returns **void** — that is the contract, so no caller can accidentally await
analytics — swallows every failure, and hands the insert to `ctx.waitUntil`. The same posture as the
Resend sends: the signup is the product, the row about it is not. The admin readout is the one
awaited query, so it is **fail-soft too** (`.catch` → `null` → an "unavailable" note), because a
deploy that lands before its migration has no table and must not take the triage list down.

### Caveats the readout states

Views include bots and repeat visits; `evaluation_conversation_requested` needs JS, so it
undercounts; and the honeypot path records **nothing**, so a tripped bot never reaches the numbers
(which is also why the hermetic e2e writes no analytics rows). Directional, not a source of record.

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
  so a researcher who is evaluating now still gets asked branch A's question. Its 12-month window is
  exported as `isActiveEvaluationTimeline` because DAR-65's Priority-B floor is the same threshold.
- `audienceFor({ role, primaryApplication })` — DAR-64's three-way split for the confirmation CTA:
  `commercial` (reusing `isCommercialUseCase`, not restating it), `research` (an answered but
  excluded signal — researcher/student/**investor**/research-education), `general` (nothing
  recognized). The step-3 gate's boolean can't serve here, because "told us they're a researcher" and
  "told us nothing" are both non-commercial but only one has an interest worth pointing at.
- `confirmationCtaFor({ audience, pilotInterest })` — the CTA itself, ordered strongest-signal-first
  with `home` as the fail-safe floor. See **The confirmation** above.
- It lives under **`$lib/server`** on purpose: the decision must never be client-authoritative, and
  the import guard makes that structural (a component physically cannot import it). The browser learns
  the next step only from a step response's `next`.
- **Not an authorization boundary.** Which step you're shown is UX, not permission: a crafted POST
  straight to `submitWaitlistStep3` — or to the branch you weren't routed to — still gets validated +
  stored (token permitting), because answering buys no privilege; the classifier judges the submitter
  by their answers either way. Re-checking a routing predicate at the write would only add a way to
  lose data. The one exception is step 4A's `contact_permission`, gated at the validator so a grant
  can only be recorded from a question that was actually on screen.

### The flow claim — why later steps don't read the row

Two decisions are settled by the **step-2** answers and re-asked by nothing afterwards: the step-4
fork (from `evaluation_timeline`) and the confirmation's CTA audience (from role/application).
Recovering them by **reading the stored row was rejected**: `next` and `cta` would then depend on
stored state, and the continuation token deliberately reaches any submitter of a known email, so a
`next: 'step4a'` would prove "this address is on the list, with a near-term timeline" to anyone who
guesses it. Instead step 2 **signs** both (`mintWaitlistFlowClaim`, payload `<branch>|<audience>` —
its own domain + `f1` prefix over the same secret, so it can never be confused with a continuation
token) and returns it as `flowClaim`; each later step's form carries it as a hidden field and the
endpoint verifies it. The MAC is what makes the hidden field safe — nobody can edit their way into
branch A's contact-collection, or promote themselves into the pilot CTA — and because the claim is
minted from answers the visitor just submitted, it tells its holder nothing they didn't already know.
It is **not** bound to the row id: it authorizes no write, it only chooses which questions render and
which link the confirmation offers.

One claim rather than one per fact: a second signed field per decision would multiply the wiring at
every step for no added guarantee, since the MAC covers the whole payload either way. Both halves are
closed vocabularies and `verifyWaitlistFlowClaim` narrows against them rather than casting.

### Two mechanics the later steps inherit

- **The signed-value echo.** Each step response returns the submitted `token` — and, through step 3,
  the `flowClaim` — verbatim (capped, never re-minted) so the NEXT step's hidden fields survive a
  no-JS re-render; after a native per-step POST the previous result is gone. Reflecting the caller's
  own input hands out nothing new, and never re-minting means one place decides what a claim says.
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
(commercial context + the server-side flow gate), **DAR-63 step 4** (the A/B intent branches) and
**DAR-64 the confirmation** (one server-chosen CTA), **DAR-65 the internal classifier + admin
triage view** and **DAR-66 first-party funnel analytics** — see the sections above. The flow is
complete end to end and instrumented.

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
(`pilot_interest` set → branch A; `research_preferences` set → branch B), which is why DAR-65's
classifier and DAR-66's funnel needed no extra column and no backfill.

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

`/admin/waitlist` is the staff triage view (gated by the `/admin` layout — access rules unchanged by
DAR-65, which only added what a signed-in staffer sees). It is a triage window, not an archive: the
read is capped at the 200 most recent, and classification/filtering happen over that window.

- **Priority column** — `WaitlistLeadClassBadge.svelte` paints the class the load computed. Priority
  A is the only badge with a ring, and rows **sort by rank first** so an A lead can't be buried under
  199 newer subscribers; `Array.sort` is stable, so newest-first survives as the within-band tiebreak.
- **Filter chips** are plain links over a `?class=` GET, so filtering works without JS and every view
  is bookmarkable. Counts are over the whole window, not the filtered slice, so the shape of the list
  stays visible while a filter is on. An unrecognized `?class=` is "no filter", never an error.
- **Outreach column** — `contact_permission` rendered as the tri-state it is: `null` = never asked
  (the pilot answer wasn't positive), `false` = asked and declined, `true` = granted (the only one
  with a filled badge). Method and phone sit in the row detail beside it.
- **Row detail** — a no-JS `<details>` per row with every v2 qualification answer (region, consent,
  application, timeline, approach, impact, budget, adoption evidence, pilot interest, deployment
  scale, contact method, phone, research preferences, reached step, last updated) plus the retired v1
  columns for historical rows. `role` resolves against BOTH label sets (v1 slugs survive as history),
  falling back to the raw slug so nothing renders blank.
- **Funnel readout** (DAR-66) — distinct anonymous flows per stage, in funnel order, plus the primary
  metric (`waitlist_signup_completed / waitlist_viewed`) resolved server-side so the view can't
  compute a different one. A null rate (nothing viewed yet, or the readout unavailable) renders as the
  page's usual em-dash, never a `0%` that would read as "nobody converts". Zero-filled, so a stage
  nobody has reached shows a `0` rather than vanishing.
- **Two standing caveats** are printed under the table rather than left to a doc nobody reads at 2am:
  the priority band is an internal guess and not pipeline, and outreach permission / phone / consent
  are unverified claims from an unauthenticated form — confirm by replying to the signed-up address
  before acting on them (see `contact_permission` below for why).

Rendering is pinned in the **client** project, where a seeded row is just a prop:
`page.svelte.spec.ts` mounts the whole page over fixture signups (badges, label resolution, the
tri-state column, the chips, the detail disclosure, and that a delete keeps the active band), and
`WaitlistLeadClassBadge.svelte.spec.ts` covers every class plus Priority A's louder treatment. It has
to live there rather than in the e2e suite: that suite is hermetic, with neither a session cookie nor
a reachable DB, so it can only assert the guard's redirect — which it does, including for a crafted
`?class=`. Mounting the page needs `$app/state` stubbed, because `Seo.svelte` reads it.

## Setup

`RESEND_API_KEY` (shared with contact) powers the emails; `BETTER_AUTH_SECRET` (already provisioned
for auth) signs the continuation token. No new secret. Schema changes follow the usual
`pnpm db:generate` + committed `drizzle/` migration (drizzle CI gate).
