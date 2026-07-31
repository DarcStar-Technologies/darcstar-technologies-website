# Waitlist — early-access lead capture (+ v2 qualification flow)

`/waitlist` captures early-access signups: a lighter-touch sibling of the contact form. Same shell
(CosmicBackdrop + centred `glass-card`, indexable). It submits through a SvelteKit **remote `form`**
(`src/lib/waitlist.remote.ts`, `joinWaitlist`) so it progressively enhances with JS and degrades to
a native POST without.

Everything lives under `src/lib/waitlist*.ts` (client-safe slug lists + labels), `src/lib/server/
waitlist*.ts` (validators, store, token, collate, notify), the `waitlist_submission` +
`waitlist_lead` tables (`db/schema.ts`), and the `/waitlist` + `/admin/waitlist` routes.

**Signups are append-only (DAR-88).** Every submit inserts a `waitlist_submission`; a repeat email
adds a row under the same `waitlist_lead` and never edits the earlier one. Read
[Append-only submissions](#append-only-submissions-dar-88) before touching the store — it is the
reason most of this document is shorter than it used to be.

## Step 1 — the core signup (live)

`/waitlist` is the v2 step-1 core signup (DAR-60): **Name + Email are required**; Organization
(`company`), Country/region (a `GlassSelect` over `WAITLIST_REGIONS` → `waitlist-labels.ts`),
and an unchecked marketing-consent checkbox (`consent_updates`) are optional. Submit persists the row
immediately, so abandoning the later qualification steps still retains the signup. It remains the one
indexable entry to the flow. (The v1 form asked for email only behind a `<details>` enrichment
disclosure; DAR-60 flattened it — role moved to step 2, phone to step 4A, and company-size / interest
/ hear-about left the UI, their columns retained per DAR-59. The interest free-text datalist and the
`+page.server.ts` load that fed it were retired with it; the load that exists today is a different
one, added by DAR-66 for the funnel and extended by DAR-75 for
[reload-resume](#resuming-after-a-reload-dar-75).) Safety rails, unchanged since v1:

- **Honeypot** `website` field — a non-empty value is silently accepted (never persisted, trap not
  revealed).
- **IP/time throttle** — at most 5 signups per hashed IP per hour (`hashIp`, the same truncated
  SHA-256 as the contact form; the raw IP is never stored). Since DAR-88 it counts **submissions**, so
  it finally sees repeat-email signups: they used to hide inside an UPDATE that added no row.
- **Insert, always** (`insertWaitlistSubmission`) — one `waitlist_submission` per submit. The
  **lead** is upserted on `lower(email)` (the unique index moved there), and the insert winning that
  conflict is what `isNew` means. The returned `id` is the **submission's**, so the continuation token
  binds to the row this submitter just created. See
  [Append-only submissions](#append-only-submissions-dar-88).
- **Emails gated on `isNew`** — a lead → `info@` and a signer ack, fire-and-forget via
  `ctx.waitUntil`. This is the mailbomb guard, and append-only makes it **more** load-bearing, not
  less: every submit now inserts a row, so "a row was created" is no longer any evidence of a new
  person. `isNew` is the LEAD insert winning — the only thing that means "we have never mailed this
  address".
- **Waitlist mail is base-locale, by signature (DAR-173).** Neither the ack nor DAR-139's
  confirmation request takes a locale — the parameter is **deleted**, not defaulted, so a caller
  cannot supply one. Both write to an address a stranger may have typed, and `isNew` caps how many
  such messages a victim receives without saying anything about who typed it. The request locale was
  not even the submitter's choice: measured, it resolves to the URL locale on a native submit and to
  the base locale on a hydrated one ([i18n](i18n.md)). The page and its validation errors stay
  localized — only the mail stops being. Guarded by `email-locale.spec.ts` + a `@ts-expect-error`
  per builder.
- **Anti-enumeration** — new vs. existing email return the identical success shape. Since DAR-88 that
  is simply true rather than a cover story: there is no difference left to hide.

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
approach**, **economic impact**, **evaluation budget** (single-selects) and **adoption requirement** (a
multi-select capped at `WAITLIST_EVIDENCE_MAX`) — plus the same Continue / Skip pair. Each carries the
survey question as `help` text (GlassSelect / GlassCheckboxGroup wire it as `aria-describedby`, so the
question is a description, not part of the control's accessible name). `WaitlistStep3.svelte` owns the
form, `submitWaitlistStep3` (`waitlist-steps.remote.ts`) the write; slugs in
`waitlist-qualification.ts`, labels in `waitlist-labels.ts`. The impact/budget answers are internal-only — never displayed back or emailed to the respondent, and never
described as pipeline.

### The budget question is scoped to an evaluation (DAR-126)

It asked for **annual** budget until DAR-126. Annual contract value is a number most respondents
can't answer credibly before a scoping conversation, so the answer was a guess or a skip — and the
bands (`under-5k` … `over-500k`) were annual-shaped, which put a realistic evaluation at the bottom of
the ladder where the facet stopped discriminating. It now asks what could go behind an **initial
evaluation or pilot**, over bands sized for that. ACV belongs in the interview.

Re-scoping a question whose answers are already stored is the interesting half:

- **Old rows keep their old slugs.** Submissions are append-only (DAR-88), so nothing is rewritten and
  no migration runs. `budget_range` simply holds answers to two different questions.
- **The retired bands are `WAITLIST_ANNUAL_BUDGETS`** and stay in `waitlistBudgetLabel`, whose key is
  the union of both sets. Dropping them would leave a raw `25k-100k` in the triage view — the "legacy
  slug renders as a slug" data loss that `role` avoids the same way.
- **New figure slugs are disjoint from the retired ones**, pinned by `waitlist-qualification.spec.ts`.
  A reused slug would collapse into one entry of that union with one label, silently mislabelling
  every row answered under the other scope. `not-involved-in-purchasing` and `not-sure` carry over on
  purpose: they describe the respondent, not a figure, so they mean the same thing either way and
  keep one label.
- **The annual labels say "(annual)".** The operator reads the value, not the question behind it, and
  $25k–$100k a year is the opposite buying signal from $25k–$50k for a pilot. Unmarked therefore means
  the field's stated scope; the admin column is named **Evaluation budget** to be that scope.
- **The step-3 validator refuses the retired bands**, so an old slug can never arrive as a new answer.
  Nothing pre-fills a select from the stored row either, so a resumed flow can't re-offer one, and the no-JS
  e2e pins the SSR'd `<select>`'s option values against `WAITLIST_BUDGETS` — the one test of the otherwise
  structural claim that a wider label map can't leak a retired band back into the form.
- **`WAITLIST_ANNUAL_BUDGETS` is append only.** Deleting an entry makes the rule blinder while disjointness
  still passes, so the spec holds each retired slug against the `waitlist_budget_annual_*` message that exists
  for it and nothing else — a restated copy of the list would only agree with itself.
- **A lead with one submission from each era shows a flagged budget conflict.** That is correct, not a
  false positive: the values genuinely differ, and DAR-88's rule is flag-never-resolve. Suppressing it
  would mean teaching the collator about eras, and hiding a cross-era difference is worse than showing
  one — it is exactly the comparison an operator should make by hand.

Nothing in the rubric moved: DAR-65's classifier structurally cannot see `budget_range`, so this
changes what an operator reads and not how anyone is scored.

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
- **The step-1 lead email was deliberately left alone.** The Priority-A notification DAR-65 sketched
  is a separate mailer with its own gate — see the next section.

## Priority-A notification (live)

**DAR-82.** One email into `info@` the first time any of a lead's submissions classifies Priority A,
so a hot prospect isn't sitting unread in the triage list.
`src/lib/server/waitlist-priority-notify.ts`; the cap lives in `waitlist-store.ts` and the column on
`waitlist_lead`.

DAR-65 specified this and deliberately did **not** build it, and the reason is worth keeping because
it stopped being true: the rubric's three signals can only all be present at a **step-4A** submit,
step 4A is authorized by the continuation token, and step 1's anti-enumeration response handed that
token to _any_ submitter of a known email — so a stranger who guessed an address on the list could
drive unlimited "Priority A!" mail into `info@`. **DAR-88 removed the premise rather than the
symptom.** Signups are append-only, so a token addresses the submission its own holder just created;
nobody can push another person's row into a band. (DAR-82 was filed hours before DAR-88 merged, which
is why the ticket still describes the blocker as live.)

### The cap is a column, not a counter

`UPDATE waitlist_lead SET priority_a_notified_at = … WHERE id = ? AND priority_a_notified_at IS NULL
RETURNING id` — one row back means this call and no other claimed the notification
(`claimPriorityLeadNotification`). Same family as `isNew` on the lead insert and the funnel's
composite key: the database decides, inside the statement that does the work, so there is no counting
query and no read-then-write race. Five concurrent step writes send one email; a spec pins that.

- **Per LEAD, so N submissions buy one email.** Append-only accepts that a stranger can pile
  submissions onto a known address; this is the bound on what that costs the inbox. The other bound
  is upstream — step 1's per-IP throttle caps how many distinct leads one source can mint. Rotating
  IPs stays edge/WAF territory, the same boundary DAR-68 and DAR-88 both drew.
- **Deliberately NOT a global rate cap.** A shared bucket would be a denial-of-notification
  primitive: flood it with junk signups and the real Priority-A lead behind them goes unannounced.
  Per-lead has no such property — one person's abuse spends one person's budget.
- **On the lead, not the submission**, exactly like `invited_at`: it records something _we_ did about
  a person. The submissions stay an immutable record of what people told us.

### Claim before send — the opposite polarity to DAR-67

DAR-67's invitation mails **first** and stamps after, so a failed send stays retryable. This one
claims **first**. The difference is who retries: an invitation has an operator standing over it,
while this fires from a visitor's step submit that will not happen again, so there is nobody to
notice a duplicate. At-most-once is the property worth buying, and the cost is bounded — a send that
fails after the claim loses one email, and the lead still sits at the top of `/admin/waitlist` in the
Priority-A band. The notification accelerates triage; it was never the system of record.

**The Resend key is checked before the claim**, or a deploy with no key would burn every lead's
one-and-only notification on sends that never happen, and the column has no reset.

### Wiring

- Hangs off `applyStepBestEffort` (`waitlist-steps.remote.ts`), the single chokepoint every enrich
  goes through — not off the four call sites, so a step added later can't forget it.
- **Every step, not just 4A.** A positive pilot answer can only come from step 4A, but it is the
  _combination_ that scores, and a visitor who reloads and walks back can supply the last missing
  piece from step 2 (provided-wins means any write can complete the triple).
- `applyWaitlistStep` returns the **post-update row** (`WaitlistStepOutcome`) so the check needs no
  follow-up read — the UPDATE already had a `RETURNING` clause to tell a permitted write from a
  refused one. `extends WaitlistLeadSignals` keeps that list covering exactly what the rubric reads.
- **Fire-and-forget, including the claim.** `captureWaitlistPriorityLead` returns void and runs both
  the claim and the send inside `ctx.waitUntil`. That isn't only tidiness: an awaited conditional
  UPDATE would add a round trip on exactly the submits that classify Priority A, and whether it
  matched a row answers "has this address been flagged before?" — state the visitor can't see. Off
  the response path, the timing difference doesn't exist to measure.

### What the email says

The address, the name, and the four rubric inputs in English labels (role canonicalized, so a legacy
v1 slug reads as the value that was actually judged), then **"invite them"** with a link to
`/admin/waitlist?class=priority-a` — DAR-67 sends invitations from that page, so "a hot lead arrived"
and "someone should invite them" are one operational moment. It closes with the standing caveat that
the band is our own guess from unverified claims and that the lead's other submissions are worth
reading first.

- **No money figures, structurally.** The builder's row list is a `Record<keyof WaitlistLeadSignals,
…>`, and `economic_impact` / `budget_range` are absent from that interface by DAR-65's design — so a
  self-reported dollar amount has no way into a message whose subject line says "Priority A". Pinned
  from the outside too, since "the type won't let you" holds only until someone widens the type.
- **The link is built from `ORIGIN`, never the request's `url.origin`**, which follows the (forgeable)
  Host header — a forged request would otherwise put an attacker-chosen URL inside an email we send
  ourselves and act on. With `ORIGIN` unset the email drops the link and still names the page.

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
who could recompute it. Each step **echoes it verbatim** exactly as it echoes the continuation token:
without JS every step is a native POST that re-renders the page, whose load mints a fresh one, so an
unechoed handle would split one visitor across four flows. Since DAR-75 a **resumed** visitor keeps
theirs too — the load reuses the id inside the resume cookie rather than generating a fresh one (it
mints a handle around it either way) — which closes the
same split for a mid-flow reload, and makes the re-recorded `waitlist_viewed` a no-op against the
composite key instead of a second view for one visitor.

### The flow id is signed on the wire (DAR-86)

It used to travel bare, and that made the composite key cap a flow **the caller chose**: a fresh
`crypto.randomUUID()` per POST defeated it outright, and the step endpoints and the public command
reached the insert with **no continuation token at all** — a bare POST at step 2 wrote analytics rows
for free. It now travels as `n1.<uuid>.<exp>.<mac>` on the shared signing core (`mintSignedValue`, its
own domain + prefix; TTL below), minted **only** by the load, so a row costs a page view — the same floor
`waitlist_viewed`'s own plain GET has always had, and the one DAR-66 accepted as irreducible without a
captcha. It doesn't make the table unwritable by a script; it makes each write cost what an honest
visitor's write costs.

Four things worth keeping:

- **The column still holds the bare UUID.** Only the transport is signed, so the schema, every stored
  row and every count are untouched: no migration, and "a count of distinct flows" still means what it
  did. Handles in flight across the deploy simply stop being counted.
- **The two forms are different TYPES.** `WaitlistFlowId` is branded, so every request crosses from
  wire value to vouched-for id exactly once — at `resolveWaitlistFlowId`, which every public entry
  point calls — and a call site that skipped the crossing wouldn't compile. The `isWaitlistFlowId`
  check inside the capture is the runtime half, and it is why forgetting fails **closed** even under a
  cast: a signed handle isn't UUID-shaped, so the mistake records nothing rather than filling the
  column with attacker-supplied text.
- **The resume cookie carries the BARE id**, and that isn't a preference — the signing core splits on
  `.`, so a signed value cannot be a field inside another signed value. Which settles the rest of the
  shape: the steps need the bare id for the cookie anyway, so they are the ones that verify, and the
  capture keeps taking something already vouched for. (Tried the other way round first; the resume
  spec caught it.)
- **No secret means no funnel, uniformly.** A deploy missing `BETTER_AUTH_SECRET` can't mint handles
  either, so every stage goes dark together rather than leaving `waitlist_viewed` climbing against zero
  conversions — a readout that misleads worse than an absent one. Same posture as the rest of the flow
  there: no continuation token, no resume, no enrich.

The cap is on the **flow**, not the handle: two signed strings for one id still collapse to one row
per event, so re-signing buys nothing. Rejected alternative (from the ticket): gating the capture on
the step write having succeeded, which would make DAR-68's per-row budget bound this transitively. It
destroys the metric — `qualification_started` fires for a **Skip**, which writes nothing, and skip-only
flows are precisely the drop-off the funnel exists to measure.

### The handle outlives the token, on purpose (DAR-98)

A funnel handle is good for a **year**, not the 24h the flow's other three signed values share, and
the question that settles it is what an expiry buys here. The other three are **capabilities** — the
token authorizes a write, the flow claim carries a routing decision, the resume cookie re-mints both —
and a capability has to age out. A handle authorizes nothing. Its bound is the composite primary key,
which is absolute and permanent: one row per event however long it lives. A shorter life doesn't lower
that ceiling, it only moves when the rows may land — banking a year of harvested handles buys no more
rows than spending them the day they were minted, and the readout is all-time and unfiltered anyway.
The 24h was inherited symmetry with the token, not a property anyone needed.

What it cost was the one thing the handle is for. A step from a tab older than the window resolved to
nothing, and that cost the visitor their flow **twice over**: the remaining stages recorded nothing (a
null id records nothing), and the null went into the resume cookie, after which every render minted a
fresh flow and wrote another `waitlist_viewed` — the load reads that cookie and never writes one, so
nothing repaired it, and each step re-issued it for another 24h. Numerator down, denominator up; DAR-75's
`__data.json` over-count exactly, resurrected by expiry.

The principle was already settled: DAR-83 keeps the step funnel recording for a visitor whose
**continuation token** aged out, because they really did reach that stage. This is the same rule
applied to the handle's own clock — **measurement must not be gated on authorization** — so a day-old
tab now fails to enrich (correct, the capability expired) while still being counted (also correct, the
visitor is still that visitor). It stays an expiry rather than none: the signing core requires one, a
never-expires mode would change shared code three other values depend on, and a value that cannot age
out is a permanent bearer artifact. Nothing on the visitor's device lives longer — the resume cookie,
the only thing that persists an id there, is untouched at 24h.

Rejected (the ticket's other two options): a **cookie write inside the load**, which DAR-75 kept
read-only on purpose — `<body>` sets `preload-data="hover"`, so a mouse-over runs it, and that is the
`?restart` trap next door; and **accepting expired handles for the cookie only**, which puts a second
verification mode beside DAR-86's one crossing in exchange for a property just shown to be worthless,
and is a half-fix anyway — the step carrying the expired handle still records nothing. Also rejected:
suppressing `waitlist_viewed` when a resumed visitor has no flow id, which trades denominator inflation
for step events on a view-less flow, counting one visitor twice in the numerator. One flow throughout
is the only shape that's simply correct.

Left open, deliberately: the underlying "an empty stored flow id is never repaired" that the ticket
called partly pre-existing. Reaching it now takes a **deliberately** malformed handle in the hidden
field, and doing so only strands the author's own flow — every extra `waitlist_viewed` it produces
still costs them a real page load, DAR-86's floor for the whole table. It dents your own row of the
readout; it can't move anyone else's.

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
   being able to inflate the numbers this exists to report. It used to remain true that a script could
   mint fresh flow ids and add a row per call; **DAR-86 closed that** by signing the handle, so this
   endpoint now costs a page load per flow like everything else. The readout is still labelled
   directional — views include bots and repeat visits either way.

### Failure is silent, everywhere

`captureWaitlistFunnel` returns **void** — that is the contract, so no caller can accidentally await
analytics — swallows every failure, and hands the insert to `ctx.waitUntil`. The same posture as the
Resend sends: the signup is the product, the row about it is not. The admin readout is the one
awaited query, so it is **fail-soft too** (`.catch` → `null` → an "unavailable" note), because a
deploy that lands before its migration has no table and must not take the triage list down.

### Links to /waitlist must not prefetch on hover

`app.html` sets `data-sveltekit-preload-data="hover"` on `<body>`, and preloading **data** means
running the page's load — which is where the view is recorded. Left at the default, every mouse pass
over a link would count a view for a page nobody opened, permanently understating the primary metric.
Every link to /waitlist therefore opts down to `data-sveltekit-preload-data="tap"`: the fetch starts on
pointerdown, so the latency win survives, and a hover-then-click reuses that single request — a real
visitor is fetched once and counted once.

**A new link to /waitlist needs the same attribute.** DAR-67 added three, and the reason the rule is
worth restating is that they arrived from a completely unrelated change (closing public sign-up), which
is exactly how this kind of regression gets in: the navbar "Request access" link and the `LoginDialog`
prompt are BOTH rendered on every page, and the `/signup` notice and `/login` page carry one each.
Current set: homepage CTA · footer · navbar · `LoginDialog` · `/login` · `/signup`.
`page.svelte.e2e.ts` asserts at the network layer that a hover triggers no `/waitlist/__data.json`, and
that a click still triggers exactly one.

### The honeypot writes no funnel events either (DAR-83)

Step 1 has always withheld `waitlist_signup_completed` when the trap trips, so a bot never enters the
conversion metric. Steps 2–4 were the exception: the honeypot hands back a **decoy continuation
token**, and a bot that drove the rest of the flow with it still emitted `qualification_started` and
every stage after — so the later stages could exceed the signups they descend from, an impossible
sequence that sends whoever next reads the funnel hunting a bug that isn't there. (Our own hermetic
e2e reaches the token-gated steps _via_ that decoy token, so a run against a reachable database was
one of the sources.) The step endpoints now capture through `captureWaitlistStepFunnel`, which drops
everything for a decoy id — the trap's effect is uniform across both surfaces it can reach: no
submission row, no funnel row.

Three things worth keeping:

- **The gate is free, and the cost DAR-66 weighed was already being paid.** It priced this at "an HMAC
  per step", but every step already verifies the continuation token before it can enrich, and since
  DAR-75 the resume cookie needs the resolved id too. What was left to add is a string comparison.
- **Decoy only, never a null id.** Absent / malformed / expired / tampered / no signing secret all
  arrive as `null`, and none of them is evidence of a bot: the visitor whose token aged out mid-flow
  really did reach that stage, and gating on validity would take the whole step funnel dark on a
  deploy with no `BETTER_AUTH_SECRET` rather than merely stop enriching. The decoy is the one id that
  carries a positive signal, because it exists only for someone who filled a field no human can see.
- **Suppressing is safe here and nowhere else on the honeypot path.** The insert is fire-and-forget
  inside `ctx.waitUntil` and the counts live behind `/admin`, so a row that never gets written is
  invisible to the caller — which is exactly what isn't true of the decoy token or the resume cookie,
  both of which the trap mints because their absence would be a detectable response difference.

**The view event needs no gate**, and neither does step 1: the trap returns before step 1's capture,
and a resumed visitor keeps their flow id, so a decoy flow's reloaded `waitlist_viewed` collides with
the row its own first GET already wrote. The first view is unknowable anyway — it happens before the
trap is tripped.

No type can force the step endpoints through the gate (`captureWaitlistFunnel` stays exported for step
1 and the page load), so `waitlist-funnel.spec.ts` reads source and pins the **import** — a call site
cannot exist without the binding, and pinning the import rather than the call text can't be tripped by
a comment naming the ungated function — plus at least one gated call per exported step form.

#### The scan covers all of `src`, not one file (DAR-102)

That spec read `waitlist-steps.remote.ts` and nothing else, which made "a fifth step can't quietly
under-report" true only of a fifth step written **into that same file**. One added as its own module
could import the ungated `captureWaitlistFunnel`, skip the gate, and pass every assertion, because
none of them ever looked at it — measured, not reasoned about: the pre-DAR-102 spec stayed 48/48 green
with exactly that file sitting in the tree.

The rule is now an **allowlist over every source file under `src`** (`source-scan.ts`). Three files
may import the ungated entry point, each recorded with its reason — step 1 (mints the token, and the
trap returns before its capture), the page load (the view precedes the trap), the client-fired command
(DAR-75 has dropped the row id by then). Everything else either goes through the gate or doesn't touch
the funnel.

**It is `src` rather than the waitlist's own directories because the first cut reproduced the very
defect one level down.** Scoped to those directories, a token-gated step planted at
`src/routes/waitlist/step5/+page.server.ts` passed **56/56** — `readdirSync` was not recursive — and
one under `src/routes/api/` would not have been looked at either. "Who imports the ungated capture
function?" has no reason to stop at a directory boundary, and nothing outside the waitlist imports it,
so the wider set costs nothing. The same correction applies to DAR-99's cast-route and caller checks,
which are now app-wide for the same reason; only "the env key is named in exactly one file" stays
scoped to the waitlist, because `auth.ts` names it legitimately. **The scope of each rule is set by
where its exception actually lives.**

Three things worth keeping:

- **An allowlist, not a classifier.** The alternative was "a file that verifies a continuation token
  must gate", and it is weaker in a way that matters: extract `resolveStepRow` into a shared helper
  and the new step endpoint imports `verifyWaitlistToken` nowhere, so the classifier stops seeing it.
  The allowlist doesn't care how a file came by its row id — it fails closed for **any** new file.
- **A hand-written allowlist is fine where a hand-written scan list is not**, and the difference is
  polarity. Deleting an entry from a scan list makes the scan blind — silent, and the exact defect
  DAR-99 measured at 7/7 passing. Deleting one here makes the rule _stricter_, so that file starts
  failing. A paired assertion keeps the list honest in the other direction too: an entry whose file
  has stopped importing the ungated function fails, so the list can't rot into names nobody checks.
- **The exemption is per CALL SITE, not per file**, and that was measured rather than designed in: a
  file-level pass let a fifth step added _inside_ one of the three inherit its exemption — appending
  one to `waitlist.remote.ts` that used the ungated function was invisible unless it also happened to
  follow the `submitWaitlistStep` naming convention. Each exempt file therefore declares how many
  ungated captures its reason covers (one, in all three cases), and the count is two-sided: adding a
  second fails, and so does removing the one, which stops the entry rotting into a permanent pass.
- **An import pin has four ways of being walked past, and all four are closed.** An **alias**
  (`{ captureWaitlistFunnel as record }`) reports under its exported name; a **namespace**
  (`import * as`) is banned; a **re-export** (`export { … } from`, `export * from`) counts as a
  binding, because handing the name on is what an import does too, and reading only `import` leaves
  a one-module laundering path; and a **relative specifier** counts, because a file inside
  `$lib/server` reaches its neighbour as `'./waitlist-funnel'`. Each is mutation-proven.

  That last one has a trap worth stating, since getting it wrong is a _false failure_ rather than a
  miss: there are **two** `waitlist-funnel` modules — the gated server one and the client event
  vocabulary — so `'./waitlist-funnel'` means different files depending on where it is written.
  Specifiers are therefore **resolved against the importing file's directory**, not string-matched;
  the string-matching cut would have reported a legal `import * as f from './waitlist-funnel'` in
  `$lib` as reaching the server module.

The remaining gap is honest and narrow, and it is no longer about the gate. Every route to the
_ungated_ function is closed — by name, alias, namespace, re-export, specifier spelling, quote style,
and now call-site count. What is still only convention-deep is **firing nothing at all**: the
"one gated call per step form" assertion recognizes the `submitWaitlistStep` naming convention, so a
step exported under some other name that captures no event simply under-reports. That fails quieter
than a bypass but does not corrupt the funnel with events the gate should have dropped — a missing
number rather than a wrong one.

The honeypot's false positives (a password manager filling the hidden field) lose their funnel events
along with everything else, which is the **same** trade the trap already makes: that visitor's signup
was never stored either. Before this, they were one of the shapes that produced the inversion — later
stages under a flow with no signup.

### Caveats the readout states

Views include bots and repeat visits, and `evaluation_conversation_requested` needs JS, so it
undercounts. **One** way a later stage can still outrun `waitlist_signup_completed`, deliberately open:
`evaluation_conversation_requested` fired from a **decoy** flow, whose row id the resume cookie has
deliberately dropped by the time the confirmation renders, so the command that fires it cannot know it
is on one. (The other one — an unauthenticated POST straight at a step endpoint with a self-minted flow
id — closed with DAR-86: a POST can no longer produce a handle at all.) Directional, not a source of
record.

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
  DB-free even on the answered paths. The funnel capture carries the **same** decoy gate (DAR-83), one
  level up: a Skip or an all-blank Continue records events without reaching this function at all.

## Resuming after a reload (DAR-75)

Every screen above is rendered from a remote-form **result**, which is per-response: it vanishes on
reload or navigation. `/waitlist` had no server load at the time, so a fresh GET had nothing that
could say "this browser already signed up" — a visitor who reloaded at step 3 was shown the empty
step-1 form again. Never lossy (step 1 persists before step 2 renders, and a re-submit is just
another append-only row), but a confusing second look at a form they'd filled in.

The state now rides a **signed, httpOnly resume cookie** — `waitlist_resume`,
`$lib/server/waitlist-resume.ts`.

- **Why a cookie and not the URL.** `/waitlist?c=<token>` was the obvious alternative and it's worse
  than the bug: it puts a row-authorizing capability into browser history, `Referer` headers and any
  link the visitor shares. The third option — a re-submit of a known address landing on the
  confirmation — can't be built without branching on `isNew`, which is exactly the difference step
  1's response shape exists to hide.
- **Strictly necessary, and therefore disclosed rather than consented.** It only remembers where the
  visitor is in a form they're actively filling in, so it needs no banner — but it does need
  `privacy_collect_technical_body`, which used to state the only cookies are the sign-in ones. That
  sentence and `PRIVACY_UPDATED` were both updated; see [legal](legal.md).
- **What it carries**: `stage|submissionId|branch|audience|cta|flowId`, signed with a **third**
  domain + `r1` prefix on the shared `mintSignedValue` core (alongside the token's `v1`, the flow
  claim's `f1` and the funnel handle's `n1`), so none of the four can be presented as another. The
  `flowId` field is the **bare** id, not the signed handle the hidden fields carry — the core splits
  on `.`, so a signed value can't be a field inside another one (DAR-86). Verification **fails closed** on
  any component outside its vocabulary — a blank step-1 form is the safe answer, being exactly the
  behaviour this replaced.
- **Signed, even though tampering grants nothing.** Routing is UX, not authorization
  (`waitlist-flow.ts`), so a forged `stage` buys no privilege — but "the client cannot choose its own
  step" stays structural rather than a per-field argument, and the MAC carries an expiry the browser
  can't extend by editing `Max-Age`.
- **The row id is dropped at `done`.** A finished flow has nothing left to write, so its cookie stops
  carrying a handle the load could turn back into a write token. It chooses a screen and a link.
- **The load re-mints, it doesn't store.** `+page.server.ts` verifies the cookie and mints a fresh
  continuation token from `submissionId` and a fresh flow claim from `branch`+`audience`, so the page
  receives the same props on a resumed render as on an in-flight one and never learns which it got.
  It reads **no** database row — the same anti-oracle property the step endpoints keep by routing on
  answers rather than stored state.
- **A resumed render sets `cache-control: private, no-store`.** It is the only **cacheable** response
  in the flow that carries a continuation token — every in-flight step is the answer to a POST — so a
  shared cache storing it would hand one visitor a write capability for another's row. Stated
  explicitly rather than resting on "nothing sets `cache-control`, so nothing caches HTML".
- **One flow, not two** (DAR-66). A resumed visitor keeps the flow id their earlier events were
  recorded under; re-recording `waitlist_viewed` under it is a no-op thanks to the composite key, so
  a reload no longer inflates the denominator _or_ strands `qualification_completed` on a second flow.
- **It also closed a `waitlist_viewed` over-count nobody had spotted.** Kit **auto-invalidates loads
  after a remote-`form` submission, and does it with a real `GET /waitlist/__data.json`** — which
  lands on the `request.method === 'GET'` branch where the view is recorded. Every hydrated step
  submit was therefore minting a fresh flow id and writing another view: one visitor working the full
  flow produced ~5 rows, understating the primary conversion rate several-fold. (The no-JS path was
  always correct — its steps are native POSTs, which the method guard already excluded.) Reusing the
  cookie's id makes each of those a no-op, and an e2e now asserts the invalidation response carries
  the _same_ flow id. Residual, accepted: a visitor who triggers an invalidation on `/waitlist`
  before signing up — submitting the layout-mounted contact modal, say — still books a second view.
  Distinguishing a data re-fetch from a page view would mean keying on `x-sveltekit-invalidated`, a
  Kit internal, and `Sec-Fetch-Dest` is no good either — it would drop every client-side navigation
  to the page, undercounting real visitors.
- **The escape hatch is a POST** (`restartWaitlist`, `waitlist.remote.ts`), and it is load-bearing,
  not polish. Without it, someone who finished the flow and came back to sign up a colleague would
  meet the confirmation with no form at all — a worse dead end than the original bug. It renders
  **only on a resumed render**, outside the card.
- **It was `<a href="?restart">` first, and that was wrong three ways** — worth recording, because
  every one of them is a Kit-specific trap and two only showed up at runtime:
  1. **A destructive GET behind an internal link fires itself.** `<body>` sets
     `preload-data="hover"`, and preloading data runs the load — so a mouse merely passing over the
     link dropped the cookie, no click required. It's DAR-66's prefetch trap again, destructive
     rather than just miscounted.
  2. **The client router re-rendered from cache.** The load redirected `?restart` back to the bare
     path so the parameter couldn't linger, but that lands on the SAME url the current page's data
     came from, so the router correctly concluded nothing it tracks had changed. The cookie really
     was gone; the page just kept showing the resumed step. `data-sveltekit-reload` fixed both 1 and
     2 — a mitigation for a hazard the method choice removes outright.
  3. **It made DAR-64's one-CTA confirmation a matter of interpretation**, since a second `<a>` sat
     on that screen. A submit button isn't a link, so the rule now holds literally (pinned by an
     e2e link count).

  The general rule the detour leaves behind: **a state mutation belongs behind a POST, and if you
  ever do put one behind an internal link it needs `data-sveltekit-reload`** — asserted by behaviour,
  never by reading the attribute, which would have passed against the broken version.

- **The POST redirects (303) rather than returning**, and that buys something concrete beyond a clean
  URL and no re-POST prompt: without JS the response to a remote-form POST is a page **re-render**,
  and the funnel records views on GET only (DAR-66's guard against counting per-step POSTs). A
  restarted no-JS visitor would otherwise begin a fresh flow whose signup had no view behind it. The
  303 makes the landing a real GET, so the new flow is counted like any other arrival.
- **The honeypot sets it too**, around the decoy id. Skipping it would make the trap detectable from
  a response _header_, a far louder tell than the timing side-channel already accepted — and it costs
  nothing, since a decoy resumes into a flow whose every write no-ops. It's also what keeps the
  reload e2e specs DB-free.

`path` is `/` rather than `/waitlist`: locale lives in the URL, so the page is reachable at both
`/waitlist` and `/es/waitlist`, and a path-scoped cookie would be silently dropped by a visitor who
switched language mid-flow.

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

`waitlist_submission` (the `waitlist` table before DAR-88) grew nullable columns for steps 1–4
(country/consent, application/role/timeline, approach/impact/budget/evidence, pilot details,
research prefs). Slug values are validated against
`$lib/waitlist-qualification.ts` (the single client-safe source shared by the step forms and the
server validators). Two multi-selects (`adoption_evidence`, `research_preferences`) store JSON string
arrays. `role` is shared between v1 and v2 slug sets — legacy v1 slugs remain as history, new writes
use the v2 set; **a consumer that branches on `role` must canonicalize v1→v2 first**
(`canonicalizeWaitlistRole`, in `waitlist-flow.ts`).

`qualification_step` is a monotonic integer high-water mark (1 = signup … 4 = a branch). Which
step-4 **branch** completed is NOT stored — derive it from the branch-specific columns
(`pilot_interest` set → branch A; `research_preferences` set → branch B), which is why DAR-65's
classifier and DAR-66's funnel needed no extra column and no backfill.

### One signing secret, and it is a type (DAR-99)

The flow has **four** signed values — the continuation token (`v1`), the flow claim (`f1`), the resume
cookie (`r1`) and the funnel handle (`n1`) — all on the same `mintSignedValue` core, all keyed off
`BETTER_AUTH_SECRET`, all told apart by their domain and prefix.

Every one of them is **minted in one module and verified in another**. Their domain and prefix are
module-private constants both ends read, so those cannot drift. The secret was the exception: seven
call sites each resolved it independently, and nothing proved they agreed — the unit specs round-trip
mint → verify _inside_ one module with the secret passed in, and the hermetic e2e has no reachable
database, so the enrich and the funnel insert are no-ops there while the token and claim are checked
only by **shape** in the rendered hidden fields. Two gates that fail closed into something that reads
like a pass, which is DAR-81's pattern.

A mismatch would be silent four different ways, none of them an error anyone sees: the funnel records
views and nothing else (reading as "nobody converts"), steps 2–4 quietly stop enriching, every visitor
routes to branch B and gets the least-committal CTA, and reloads drop back to the blank form.

So there is one resolver — `waitlistSigningSecret()` in `$lib/server/waitlist-secret.ts` — and its
return type is **branded**. One resolver alone would make a _rename_ safe; the brand is what catches
the other two drifts, a per-purpose secret at one end or a new entry point resolving for itself, since
both compile fine against `secret: string`. Now each is a compile error at the offending call site,
the same move `WaitlistFlowId` makes for the flow id (DAR-86). It found a real one on the way in:
`resolveStepRow` and `rememberStep` typed the secret as a bare `string`, so every step's token and
cookie crossed an untyped hop.

Three things worth keeping. The resolver lives in **its own module** rather than beside the signing
core because `readEnv` pulls in `$app/server`, and the four signing modules are deliberately
request-free — that purity is what lets their specs round-trip without a request. The brand is erased
at runtime, so a **cast** still defeats it, and `waitlist-secret.spec.ts` is the backstop: across the
surface the key may be named in one file, the brand may be cast into existence in one file, and every
caller must import the resolver by name (an import pin, not call text — DAR-83's lesson). And that
spec **derives its file list** from the directories rather than hand-listing paths, because the first
cut hand-listed them and dropping one entry made the scan blind while staying green — measured, 7/7
passing against a drifted file. The reading, comment-stripping and import-parsing now live in
`source-scan.ts`, shared with DAR-102's funnel-gate scan, so there is one implementation rather than
two that can drift. The two rules do **not** share a surface, though: the funnel gate scans all of
`src`, while "the env key is named in exactly one file" has to stay scoped to the waitlist, because
`auth.ts` names that key legitimately — it is Better Auth's own. The other two secret assertions (the
brand cast, and callers importing the resolver by name) have no such exception and so went app-wide
with DAR-102.

The key stays Better Auth's own rather than a second secret to provision; the per-value domain
separation is what makes sharing it safe. Repointing the resolver elsewhere would keep the four values
consistent with each other while quietly ending that reuse — a decision, not a rename.

### Continuation token (`waitlist-token.ts`)

Steps 2–4 are **unauthenticated** writes that enrich the row step 1 created, so step 1's response
carries a signed, expiring token; each later step submits it back and the server verifies before
updating. `v1.<rowId>.<exp>.<mac>` — HMAC-SHA-256, 24h TTL, over the shared signing secret above (the
`darcstar:waitlist-continuation:v1` domain prefix separates these MACs from anything Better Auth
signs). Guarantees, all unit-pinned:

- A raw row id is never accepted; the MAC binds id **and** exp (no swap/extend).
- Verification failure is a generic `null` — callers respond identically for bad-token / row-gone,
  so the token layer isn't a row/email-enumeration oracle.
- Tokens are **canonical**: one `(id, exp)` → exactly one valid string (exp has no leading zeros; the
  decoded MAC must re-encode to the received bytes). This isn't a capability boundary today — it
  keeps a future exact-string dedup/blocklist from being bypassed by equivalent token strings.

**The token binds to the submission its own holder just created (DAR-88).** Step 1 always inserts, so
a stranger who submits a known address receives a token for _their own_ row and can never reach the
real person's answers. That is the whole authorization story now, and it is why the write-policy
taxonomy this section used to describe is gone: before DAR-88 a repeat email resolved to the FIRST
submitter's row and handed that row's id out with it, which is what DAR-59's per-field policies and
DAR-72's `phone`/`contact_permission` rules existed to contain.

`applyWaitlistStep` keeps its explicit **per-step column map** — a step can only write its own
columns, never identity, never another step's answers — but as blast-radius and legibility rather than
as a security boundary. Adding a column to a step now only needs "does this step ask that question",
not "who else could write this, and what could they do with it". (The honeypot path returns a _decoy_
token — deterministic per email, addressing no real row — so the response body matches a real success;
a timing side-channel still distinguishes the trap, which is accepted.)

### Step-write budget (DAR-68)

A token holder could drive **unbounded `UPDATE`s** at their row: the steps add no row, and step 1's
throttle counts _rows created per hashed IP_, so nothing capped them. Not a data-integrity problem
(the column map above bounds _what_ can change) — a cost one. DAR-88 narrowed the threat (the row is
now the holder's own) but not the cost, so this stands unchanged.

The cap is **per row**, not per IP: a token addresses exactly one row, which makes the row the thing
being abused, and keying on it doesn't punish everyone behind a shared NAT for one of them. It is
**`WAITLIST_STEP_WRITE_MAX` (20) step writes per row per hour**, and it lives as a **`WHERE` predicate on the
`UPDATE` `applyWaitlistStep` was already making**, with the counter in two columns on the row
(`step_write_count`, `step_write_window_at`). Three properties follow, and each is why it's built
that way:

- **No extra query.** A permitted step costs what it always did; a refused one costs one `UPDATE`
  matching zero rows — strictly _less_ than the write it replaces. A counter table (Better Auth's
  `rate_limit` was the obvious candidate) inverts that: spending a read plus a write to refuse a
  write is protecting the database by hammering it, and refusals get more expensive exactly as abuse
  gets worse.
- **No oracle, structurally.** The constraint was that a throttle must not leak token validity. There
  is no code path that could: the guard isn't a check that runs before the write and returns a
  verdict, it **is** the write. In the **response** — the only thing a caller sees — a refused step, a
  decoy token, an expired token, a deleted row and a success are one generic success. (Timing still
  separates "the DB was touched" from "it wasn't", since an invalid or decoy token short-circuits
  before the round trip; that channel predates this and is accepted at the token layer, and the budget
  adds nothing to it because a refusal takes the same round trip a write does.)
- **Nothing is lost.** A refusal drops one enrichment, never a signup.

The cap is deliberately far above a real ceiling (the whole flow is three writes) rather than snug
against it, because the refusal is **silent** — a cap tight enough to catch a visitor would eat their
answers with no error. A unit spec walks the full flow five times over to keep it that way.
SQLite evaluates `SET` expressions against the **pre-update** row, which is what lets the counter
read and replace itself in one statement; the window is **fixed, not sliding** (a write inside a live
window doesn't move its start, and a _refused_ write touches nothing, so hammering can't extend its
own lockout).

**What this does not bound**, stated plainly: request _volume_ (a refused POST still costs a Worker
round trip), and an attacker holding tokens for N rows gets N budgets. Neither is fixable at this
layer — volumetric defense against a distributed or multi-token flood belongs at the edge (a
Cloudflare rate-limiting rule on `/waitlist`), where rotating tokens can't sidestep it.

**Targeted exhaustion went away with DAR-88.** This paragraph used to concede that, because the token
reached any submitter of a known address, someone could spend a specific person's budget and silently
block that person's own enrichment. A token now addresses the row its own holder created, so the only
budget anyone can exhaust is their own. What remains is a self-inflicted cap, which is why it sits far
above a real visitor's ceiling. Related trade-off, unchanged: a refusal is **not observable** (no log,
no metric), because telling "refused" apart from "row gone" would take the extra read the design
exists to avoid.

The **funnel-event insert on these same endpoints used to be a separate, unbounded vector** — `flow_id`
was client-minted, so rotating it defeated the composite-key cap, and it didn't even need a valid
token. **Closed by DAR-86**, which signs the flow id rather than gating analytics on the step write
(that would stop counting the skips the funnel exists to measure): only the /waitlist load mints a
handle, so a funnel row costs a page view. DAR-83 had already narrowed it by one case — a **decoy**
token records nothing, so a bot that trips the honeypot writes no analytics either.

The sibling hole this section used to name — the **step-1 enrich** being throttle-exempt, because a
known email enriched an existing row and so never trips the row-count check (DAR-87) — **was closed by
DAR-88 rather than by a fix of its own**: there is no enrich any more, every submit inserts a row, and
the per-IP row-count throttle counts them all.

### Consent

`consent_updates` is an **unverified single-opt-in claim** — the form is unauthenticated, so a third
party can submit any address with the box ticked. **It must not drive a real send without
double-opt-in + unsubscribe.**

Since DAR-88 it is recorded **per submission**, with its own `consent_updates_at` and the row's own
`ip_hash` beside it. That is a straight compliance upgrade over the monotonic flag it replaces, which
had been `max()`'d forward across an unknown number of submitters and could only say "someone, once,
ticked a box". An unticked box on a later submission is that submitter's own "no", not a revocation of
an earlier grant — each row states what one person did, and nothing reaches across rows. Revocation
remains a future unsubscribe mechanism, not a form default.

**Since DAR-121 the gate is public.** `/privacy` used to claim "waitlist email is only about early
access" while this box offered product updates; its "How we use it" section now separates operational
mail from optional updates and states, to the visitor, that the updates aren't being sent and won't be
until there is a confirmation step and a login-free unsubscribe. So building the send is not only a
waitlist change: `privacy_use_updates_body` and `PRIVACY_UPDATED` change with it
([legal](legal.md)), and `email-senders.spec.ts` fails until the new mailer is declared —
deliberately, so the page can't go stale quietly.

### The sending gate (DAR-139)

**A ticked box is a request to be ASKED. The only thing that authorizes a send is a click from the
mailbox.** Three columns on `waitlist_lead` — on the lead, and here that is forced rather than merely
consistent with DAR-88: a withdrawal is a decision about a person, and recording it per submission
would need a write reaching across N immutable rows.

| column                    | meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `updates_confirm_sent_at` | when we last asked. **The cap.**                                      |
| `updates_confirmed_at`    | when the mailbox clicked confirm. **The only authorization.**         |
| `updates_unsubscribed_at` | when they withdrew. Durable; suppresses asking and sending, for good. |

`updates_confirmed_at` is **kept** after a withdrawal — the audit trail of what happened, and
`mayReceiveUpdates` already excludes a withdrawn lead, so clearing it would destroy evidence to buy
nothing. That is also why `waitlistUpdatesState` (`$lib/waitlist-updates.ts`) tests withdrawal
**first**: checking confirmation first would report every opted-out address as still subscribed.

**The rule lives in two encodings and they are pinned against each other.** `mayReceiveUpdates` (a
predicate, client-safe, rendered as the `/admin/waitlist` badge) and `readUpdatesAudience`
(waitlist-store.ts, the same rule as a `WHERE`) cannot be single-sourced because one is SQL —
DAR-71's situation for the `noIndex` filter that lives half in GROQ — so `waitlist-store.spec.ts` runs
a table of leads through both and requires them to agree. No sender calls the audience query yet;
shipping the definition with the gate is the point, so the rule has one home before the first send is
written. What that can't do is force a future author to use it — removing the _silent_ path is
`email-senders.spec.ts`'s job, and its failure message names the function.

**Asking is capped by a conditional UPDATE, and the polarity differs from DAR-82 on purpose.**
`claimUpdatesConfirmSend` refuses when the address has confirmed, has withdrawn, or was asked inside
the last 24h; one row back means this call and no other may send. A **rate**, not DAR-82's once-ever
quota, because that notification lands in our own inbox with an operator standing over it while this
one goes to a member of the public who may simply lose it — a re-tick tomorrow has to be able to ask
again. **Not gated on `isNew`**, which is the other tempting reuse and would have shipped the gate
unusable: every address already on the list, and anyone who signs up twice, could then tick the box
forever and never be asked.

**The new exposure, and its bound.** Before this a stranger submitting a known address caused zero
mail. Now they can cause ≤1 confirmation request per day to it. Bounds: step 1's per-IP throttle, the
per-lead window, and — decisively — the **"don't ask again" link carried in the confirmation email
itself**, which ends it permanently in one click. That is why the unsubscribe link ships in the
confirmation request rather than only in updates that don't exist yet: the person best placed to stop
an unwanted ask is the one receiving it.

**Withdrawal is durable against the form.** The tick box is the one surface a stranger controls, so a
re-tick can't restart the asks and a stale confirmation link can't reverse an opt-out (`confirmUpdates`
refuses inside its own SET expression, and the page says so rather than pretending the press did
nothing). Re-entry needs a channel the form can't reach — email us, which `/privacy` offers.

#### Honoring a request that arrives another way (DAR-140)

The link serves whoever still has the email. `/privacy` promises we act on a request emailed to us
from the address in question (`privacy_rights_body`, and now the updates paragraph too), and until
DAR-140 the only vocabulary on `/admin/waitlist` was **delete** — so honoring one meant destroying
answers nobody asked us to destroy. The `recordOptOut` action makes **exactly the
write the link makes**, so a request honored by hand and one honored by the recipient leave the same
lead in the same durable state.

**Not "clear `consent_updates` on their submissions"**, which the ticket originally proposed and which
fails three ways: the ask is triggered by the consent flag on the **incoming** submission
(`waitlist.remote.ts`), so clearing stored ones stops no future email at all; the resulting state is
indistinguishable from never having ticked the box, so the next submission asks again — a manual path
_weaker_ than the self-service one it mirrors; and it edits an append-only row, where a fabricated
submission already has the right tool in `deleteSubmission`.

`updates_unsubscribed_by` carries who recorded it — **null is the mailbox holder pressing the link**,
the strongest evidence there is, and a staff id is us transcribing a request. That distinction only
stopped being derivable from the timestamp when the second writer existed, which is why the column
arrives with this action and not with DAR-139. It is stamped under the timestamp's own
first-writer-wins guard rather than `coalesce`d on its own value: null is meaningful here, so a
`coalesce` would overwrite a self-service withdrawal the first time an operator pressed the button and
the row would claim we did what the person had already done. It is **not** part of
`WaitlistUpdatesSignals` — provenance is not state, and `waitlistUpdatesState` must keep answering from
the three timestamps alone.

**Still no re-entry**, and a finding here is why it needs its own design rather than a mirror-image
button: clearing `updates_unsubscribed_at` alone would resurrect a **stale confirmation**, since
`updates_confirmed_at` is deliberately kept, so `mayReceiveUpdates` would flip true with no fresh
consent. Clearing both instead destroys the withdrawal record. Neither is a one-line inverse.

The action is where `page.server.spec.ts` came from. SvelteKit does not run a layout guard before a
form action, only on the re-render, so each action's inline `isStaff` line is the whole authorization
boundary — and nothing proved it was there for any of the five. **Measured** rather than reasoned:
with the gate removed, an anonymous POST at a real lead answered `303 → /login` **and wrote the row**
(`updates_unsubscribed_by: "ANONYMOUS-PROBE"`). The redirect is emitted by the re-render, so it reads
exactly like a refusal while the write has already landed; a signed-in end-user gets the same shape
(`303 → /account`). That is what makes a missing gate invisible from the response, and a test the only
thing that can see it. Survivable while the vocabulary was "delete", which fails loudly; a silent
irreversible write is what made it worth closing. `/admin` redirects in CI, so this cannot be an e2e.

**Two signed values, two TTLs** (`waitlist-updates-token.ts`, fifth and sixth on the `mintSignedValue`
core): `c1` confirm at **7 days**, `u1` unsubscribe at **1 year**. DAR-98's rule applied rather than
copied — a TTL is sized to what the capability is FOR, and a grant goes stale where a removal must
work whenever the mail is found. Folding them into one token would hand the grant the removal's
lifetime.

**Both mutations are POSTs behind a landing page** (`/updates/confirm`, `/updates/unsubscribe`; both in
`GATED_PATHS`, both noindex). For confirm that is the entire security property: mail scanners follow
every link in an inbound message, so a GET-confirm is confirmed by a machine on delivery — double
opt-in that verifies nothing. For unsubscribe it is RFC 8058's own reasoning, and DAR-75's. Every token
failure — absent, malformed, expired, minted for the other page, lead deleted — renders **one generic
panel**, the continuation token's anti-oracle rule; a database failure is the one thing shown
separately, because telling somebody their withdrawal went through when it threw is the worst answer
these pages can give.

**The confirmation email names nobody.** The waitlist name is supplied by whoever filled in the form,
and this is the one message whose premise is that the submitter and the recipient may be different
people — so a greeting would let a stranger choose how we address someone else in their own inbox
(DAR-67 hit the same hazard on the invitation and answered it with "the earliest submission's name";
here the better answer is none). The field is absent from `UpdatesConfirmEmailInput`, so putting it
back is a compile error at the call site.

Coverage is split the way DAR-103 describes, and the split is **not** "CI has no secret". A local e2e
run loads `.env` through wrangler and has both a secret and a database; only CI lacks them. What
actually bounds the e2e is that a token is **unforgeable** — a test that minted one from a local `.env`
would assert different things on a developer's machine than in CI, DAR-79/DAR-81's defect — so every
token it sends is deliberately unsignable, which fails identically everywhere. It therefore asserts the
generic-failure panel, the noindex, and that a fetched link offers nothing to press; **"a GET mutates
nothing" is enforced a layer down** by `runUpdatesAction`'s method guard and unit-tested there. The
confirm → audience → withdraw composition is `pnpm smoke:waitlist` step N against a real database.
That script **mints** the two links with the same exported functions the mailer uses — the narrower
version of its no-parsing rule: it may call what the server calls, and may not reimplement or
decompose the format.

### Outreach: "don't contact me" (DAR-191)

The **second consent axis**, and it stands to `contact_permission` exactly as the sending gate above
stands to `consent_updates`:

| axis     | per-submission CLAIM (immutable) | lead-level TRUTH                                   |
| -------- | -------------------------------- | -------------------------------------------------- |
| updates  | `consent_updates`                | `updates_confirmed_at` / `updates_unsubscribed_at` |
| outreach | `contact_permission`             | `do_not_contact_at` / `do_not_contact_by`          |

You do not edit a claim, you record the truth beside it. That is why DAR-140 refused the "clear
`contact_permission`" version of this: clearing an answer stops nothing (no code sends from it),
leaves a state indistinguishable from never having been asked, and edits an append-only row. On the
lead for the sending gate's **forced** reason — a decision about a person cannot be recorded across N
immutable submissions.

**What it means: we do not initiate contact.** It suppresses three things, each as a predicate on a
statement that was already being issued rather than as a new query:

- **`?/invite`** (DAR-67) — refused after `findWaitlistInviteTarget` and **before**
  `findAccountByEmail`, so a refused invite creates no account, mints no activation token and sends no
  mail. The flag rides along on that lookup, so the refusal costs no second round trip.
- **`claimPriorityLeadNotification`** (DAR-82) — that email's call to action is literally "invite
  them", so firing it would be us prompting ourselves toward something the code now refuses.
- **`claimUpdatesConfirmSend`** (DAR-139) — DAR-83's uniformity rule. This ask is the one piece of
  mail a **stranger** can cause us to send to an address that has confirmed nothing, so leaving it
  open would let somebody re-type the address of the very person who asked us to stop.

**What it deliberately does NOT mean: unsubscribed.** `mayReceiveUpdates` never reads this column. A
confirmed subscription is a verified grant from that mailbox, revocable in one click from every
message; "don't contact me about a pilot" is not "cancel my newsletter", and conflating them would
silently destroy the strongest consent signal we hold. Someone who asked for both gets **both**
recorded — the page says so under the table, because copy is the whole mechanism there and a single
control doing both is exactly the tidy-up to refuse.

**Lifting it is admin-only**, and that asymmetry is the design rather than a permissions detail.
Recording somebody's request is ordinary staff work; un-recording it is not, and a control an operator
could press sits one click from the Invite button it suppresses — which turns a durable request into a
speed bump. What it buys back is that a mis-press on the wrong row, and a prospect who later says
"actually, let's talk", stay recoverable without deleting their submissions.

This is the **first place in the repo where `isRosterAdmin` is the whole authorization boundary**.
Everywhere else it is a UX gate with a Better Auth endpoint re-checking behind it — its own docstring
says so, and `/admin/+layout.server.ts` repeats it. A form action has nothing behind it, so the line
is the entire check, which is why `page.server.spec.ts` asserts the pair: an **operator may record and
may not lift**. Nothing else in that file can tell the two predicates apart, since every other gate
test uses an end-user or an anonymous caller and both fail either one.

The lift **clears both columns** rather than stamping a third "lifted" pair, so the durable history is
the `[outreach] donotcontact.lifted` Workers Logs line — the posture `invited_at` already has. A
lifted-at column would turn `mayContactLead` into a comparison of two timestamps for a state nobody
queries historically.

**DAR-65's classifier does not see it.** The band measures how strong a commercial signal a
submission carried, which is a fact about what they told us rather than about permission. Making it
read the flag would be a second encoding of one rule, would hide a lead an operator may legitimately
need to see, and would widen `WaitlistLeadSignals` — the four-field interface that structurally keeps
money out of the rubric. A flagged lead still sorts by band, with "Do not contact" in the Outreach
column right beside it.

**`mayContactLead`** (`$lib/waitlist-outreach.ts`) is the one definition; three `WHERE` clauses are
the same rule in SQL and cannot be single-sourced with it, so `waitlist-store.spec.ts` pins them
against each other against a real engine. Honest residual: nothing forces a future outreach surface to
call it — **DAR-177's waitlist → CRM producer is the next one that will have to** — which is the same
residual `readUpdatesAudience` shipped with, and for the same reason: the rule gets a home before that
author writes it.

### `contact_permission` is tri-state

`null` = the question wasn't shown (pilot interest not positive), `false` = shown and declined,
`true` = granted. The step-4A validator emits `null` unless the pilot answer is positive (the same
predicate, `isPositivePilotInterest`, that `WaitlistStep4A` reveals the checkbox on), and the store
keep-existings a `null` — so a not-shown submit can't clobber that submitter's own earlier answer.

Like `consent_updates`, it is an **unverified claim**. Treat step 4A's contact block as a
lead-qualification hint, **not** proof that this person asked to be called, and confirm by replying to
the signed-up address before acting on it. What DAR-88 changed is that a stranger's claim now lands on
its own submission, visible and comparable, instead of overwriting the real person's answer — but it
is still a claim, and the process rule is still the control.

### Append-only submissions (DAR-88)

**Every submit inserts a `waitlist_submission`; a repeat email adds a row under the same
`waitlist_lead` and never edits the earlier one.** Before this, a repeat email collapsed into the
existing row, and that single decision manufactured a whole class of problem:

- **Anti-enumeration was a cover story.** Step 1 must return an identical response for a new and an
  existing email — but it was hiding a real difference, and hiding it meant handing the second
  submitter a continuation token bound to the **first** submitter's row. Now there is nothing to hide:
  every submit really is new, so a stranger who guesses a known address gets a token for their own row.
- **We stored inferences as facts.** "Someone submitted X at time T from this IP" is a fact; "this
  person's phone is X" is an inference. The old model stored the inference and then argued about who
  might overwrite it — that argument _was_ DAR-59's `keepExisting`/`fillIfEmpty` split and DAR-72's
  actionable/judgement taxonomy.
- **Conflicts were destroyed.** Two different phone numbers for one address is exactly what an
  operator should see. Provided-wins and fill-forward both discarded one, in opposite directions.

**What this deleted:** all of DAR-72 (`phone` fill-forward, `contact_permission` decline-wins), the
`fillIfEmpty` / `grantFillsDeclineWins` policy pair and the per-column reasoning behind them,
`upsertWaitlist`'s enrich branch, and the `lower(email)` unique index on the signup row (it moved to
the lead). One rule remains — `coalesce(new, existing)`, provided-wins — and it is now a UX nicety
(don't lose a visitor's own answers when they walk back through a step), not an authorization policy.

**What survives:** DAR-68's per-row step-write budget (a holder can still hammer their own row), the
per-step column maps (blast radius, not authorization), and the `isNew` email gate — which gets
_more_ load-bearing, since "a row was created" is no longer evidence of a new person. `isNew` is the
LEAD insert winning its unique-index conflict, decided atomically by the database in the same
statement, so two concurrent first-signups still can't both mail.

**Costs accepted.** A repeat submitter grows the table, and a stranger can bury a real signup under
junk rows. Bounds: the per-IP row-count throttle, which finally _sees_ these writes; an operator can
delete a single junk submission (`?/deleteSubmission`) without discarding the person, or the whole
lead (cascade). No retention cap — volumetric abuse from rotating IPs is edge/WAF territory, the same
boundary [DAR-68](#step-write-budget-dar-68) drew. Poisoning did not disappear either; it **moved**,
from an invisible edit of the real record to an additional row a human can read and dismiss.

**The lead holds no answers, deliberately.** `waitlist_lead` is an identity anchor plus the things
that describe a person rather than a submission: `invited_at` / `invited_by` / `activated_at`
(DAR-67's state, moved here), `reviewed_at` / `reviewed_by`, and `priority_a_notified_at` (DAR-82's
one-per-person notification claim). Nothing on it is written by two
different actors, so no "who may overwrite what" policy can grow back. A merged-answers column set —
canonical values an operator promotes from a submission — was considered and rejected for exactly that
reason: it is the same overwrite problem with a friendlier interface, and the reconciliation belongs
in whatever the operator does next (an outreach, a CRM record), not in a column here.

**Migration** (`drizzle/0010_*.sql`) is hand-ordered: it creates both tables, seeds one lead per
existing row carrying that row's invite state and original `created_at`, re-inserts each row as that
lead's first submission **keeping its id** (live continuation tokens embed it), and only then drops
`waitlist`. Existing rows were already one-per-email, so the backfill is 1:1; if that were somehow
false the lead's unique index fails the migration _before_ the drop, which under migrate-before-deploy
blocks the deploy rather than silently merging data.

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
read is capped at the **200 most recently ACTIVE leads** — a person is one line however many times
they submitted, so capping submissions instead would let one repeat submitter push everyone else off
the page, and ordering by lead _creation_ would hide the returning prospect who submitted again this
morning behind 200 newer signups (a real hole once submissions append). Classification and filtering
happen over that window.

Collation happens at **read** time (`$lib/server/waitlist-collate.ts`) and resolves nothing: it groups
submissions under their lead, classifies each one, and **flags** the fields they disagree about.

- **Priority column** — `WaitlistLeadClassBadge.svelte` paints the class the load computed. Priority
  A is the only badge with a ring, and rows **sort by rank first** so an A lead can't be buried under
  199 newer subscribers; `Array.sort` is stable, so most-recently-active-first survives as the
  within-band tiebreak.
  A lead's band is the **strongest** any single submission earned (`classifyWaitlistLeadGroup`), and
  each submission's own band renders beside it so the badge stays attributable. The rejected
  alternative — merge the fields, then classify — could assemble a Priority A out of a role one person
  gave, a timeline another gave and a pilot answer a third gave: a lead nobody actually is. Classifying
  first makes that impossible, and it is unit-pinned.
- **Conflicts** — every answer column is compared across a lead's submissions (`WAITLIST_CONFLICT_FIELDS`,
  which a type guard forces to stay complete: a new answer column that isn't listed would silently
  never be compared). A `null` never conflicts — under progressive disclosure most submissions leave
  most fields blank, so counting absence as disagreement would flag everything and mean nothing —
  and multi-selects compare as **sets**, so checkbox order isn't a conflict. Disagreements surface as
  a count chip on the row, a named list in the detail, and a `≠` marker on each affected field.
- **Review** — `reviewed_at` / `reviewed_by` record that a human reconciled the submissions. It is a
  **stamp, not a merge**. `needsReview` is derived (newest submission is later than the stamp), so a
  new submission re-opens a reviewed lead by itself and the action never has to clear a flag.
- **Two deletes, deliberately separate** — `?/deleteSubmission` drops one junk claim and keeps the
  person; `?/delete` removes the lead and cascades to every submission. One button doing both by
  context would eventually delete the wrong thing.
- **`?/recordOptOut`** (DAR-140) — records an updates withdrawal for someone who asked by reply or
  phone rather than through the unsubscribe link, writing exactly what that link writes. Two-step
  `<details>` confirm, hidden once the address has already withdrawn (the write is idempotent, but a
  control that can only be a no-op is noise in a scanned column) and offered for `none` on purpose:
  somebody whose address a stranger typed in has never been asked and wants never to be. Reports a
  vanished lead as `not_found` rather than a silent no-op, unlike `?/delete` — nothing here undoes it.
  The lead detail carries the whole trail (asked / confirmed / opted out / **recorded by**), where a
  null recorder beside a timestamp renders as "the recipient, via the unsubscribe link" and not as a
  dash: it is our strongest record, not an absence. See [the sending gate](#honoring-a-request-that-arrives-another-way-dar-140).
- **`?/recordDoNotContact`** / **`?/liftDoNotContact`** (DAR-191) — the outreach axis, deliberately
  separate controls from the opt-out above because they answer different requests. Recording is
  `isStaff` and hides the invite control; **lifting is `isRosterAdmin`**, the only action on the page
  gated on anything but staff. See [the outreach section](#outreach-dont-contact-me-dar-191).
- **Filter chips** are plain links over a `?class=` GET, so filtering works without JS and every view
  is bookmarkable. Counts are over the whole window, not the filtered slice, so the shape of the list
  stays visible while a filter is on. An unrecognized `?class=` is "no filter", never an error.
- **Summary columns** read the **newest** submission — the most recent thing this person told us —
  rather than an aggregate, because an aggregate would have to choose. Where the choice would have
  mattered, the conflict chip says so and the detail shows every value.
- **Outreach column** — the **lead-level truth wins the cell**: a recorded do-not-contact (DAR-191)
  replaces the claim rather than sitting beside it, because the claim is an answer somebody typed into
  an unauthenticated form and the flag is where that person now stands. Otherwise
  `contact_permission` as the tri-state it is: `null` = never asked (the pilot answer wasn't
  positive), `false` = asked and declined, `true` = granted (the only one with a filled badge). A
  grant and a decline under one address is a flagged conflict, which is the honest reading of it. The
  per-submission answers stay in the row detail either way, where they can be read as the claims they
  are.
- **Row detail** — a no-JS `<details>` per lead listing **every submission**, newest first, each with
  its own timestamp, priority band, delete control, and a complete answer grid (region, consent +
  when, application, timeline, approach, impact, budget, adoption evidence, pilot interest, deployment
  scale, contact method, phone, research preferences, reached step, last updated) plus the retired v1
  columns for historical rows. Two submissions show two complete sets, never a reconciled one. `role`
  resolves against BOTH label sets (v1 slugs survive as history), falling back to the raw slug so
  nothing renders blank; `budget_range` the same way, except its retired bands are labelled
  "(annual)" because the question changed scope under them (DAR-126). The lead's own state (invited / activated / reviewed by) sits below them,
  separated because those are our actions rather than anything the person submitted.
- **Funnel readout** (DAR-66) — distinct anonymous flows per stage, in funnel order, plus the primary
  metric (`waitlist_signup_completed / waitlist_viewed`) resolved server-side so the view can't
  compute a different one. A null rate (nothing viewed yet, or the readout unavailable) renders as the
  page's usual em-dash, never a `0%` that would read as "nobody converts". Zero-filled, so a stage
  nobody has reached shows a `0` rather than vanishing.
- **Access column + Invite button** (DAR-67) — the waitlist is now the front of the account funnel,
  not just a mailing list: public sign-up is closed, so staff invite prospects from here. The column
  shows a derived three-state badge (not invited / invited / activated) and the row's action reads
  **Invite** or **Resend** to match. Full mechanics — the account creation, the activation token, why
  the send is awaited, and the `activated_at` stamp — are in [auth.md](auth.md#invite-only-onboarding-dar-67);
  what matters here is the state, below.
- **Four standing caveats** are printed under the table rather than left to a doc nobody reads at 2am:
  the priority band is an internal guess and not pipeline; outreach permission / phone / consent are
  unverified claims from an unauthenticated form (confirm by replying to the signed-up address before
  acting on them); conflicting answers are flagged and never merged, because a conflict may be a
  correction or a stranger; and submissions append rather than edit, so deleting a lead deletes all of
  them.

Rendering is pinned in the **client** project, where a seeded row is just a prop:
`page.svelte.spec.ts` mounts the whole page over fixture leads (badges, label resolution, the
tri-state column, the chips, the detail disclosure, that every action keeps the active band, and that
two submissions render two complete answer sets rather than a merged one), and
`WaitlistLeadClassBadge.svelte.spec.ts` covers every class plus Priority A's louder treatment. It has
to live there rather than in the e2e suite: that suite is hermetic, with neither a session cookie nor
a reachable DB, so it can only assert the guard's redirect — which it does, including for a crafted
`?class=`. Mounting the page needs `$app/state` stubbed, because `Seo.svelte` reads it.

## Invite-only onboarding (DAR-67)

Public self-signup is closed, so the waitlist is the only public path to an account and
`/admin/waitlist` is where that path is walked. The auth-side mechanics live in
[auth.md](auth.md#invite-only-onboarding-dar-67); what belongs here is the three columns this table
grew and what they actually assert.

`invited_at` · `invited_by` · `activated_at` sit on **`waitlist_lead`** (they were on `waitlist`
until DAR-88), not on `user`, for two reasons: the un-invited majority has no `user` row to hang them
off — "not invited" is the default state of a prospect, not of an account — and an invitation is
something we did to a **person**, who now has N submissions, so hanging it off one arbitrary
submission would leave the others looking un-invited. The badge is **derived on read**
(`waitlistInviteState`, `$lib/waitlist-invite.ts`), exactly like DAR-65's lead class and for the same
reason: it's a pure function of columns already on the row.

The invitation's **address** comes from the lead; its **name** comes from the lead's EARLIEST
submission that supplied one (`findWaitlistInviteTarget`). That ordering is load-bearing: anyone can
add a submission for a known address, so a newest-name rule would let a stranger choose how we greet
the real person in an email we send to their inbox. Oldest-non-null reproduces the pre-DAR-88
behaviour exactly, since step 1's enrich was fill-forward on `name`.

Three things about them are easy to get wrong:

1. **`invited_at` is the LAST send, not the first.** A resend overwrites it, because the operational
   question is "did I already email them, and how long ago" — a first-contact date frozen weeks back
   answers that wrongly. The durable history is the structured `[invite] activation.sent` line in
   Workers Logs, which is also the only record of _who_ invited whom over time.
2. **`invited_at` means an email was accepted by Resend, never "we tried".** The invite action sends
   BEFORE it stamps, so a failed send leaves the row looking un-invited and the button still reading
   Invite — which is the correct next move. Retrying is safe: the account created on the failed
   attempt is found rather than duplicated.
3. **`activated_at` is not "has an account".** An invited account exists from the moment the invite is
   sent; this column records the invitee actually setting a password, stamped by auth.ts's
   `onPasswordReset` hook. That hook fires for every reset on the site, so the query only stamps rows
   that were genuinely invited and aren't already stamped — otherwise an ordinary self-service reset
   by someone who happens to be on the list would flip their badge and claim an onboarding that never
   happened.

Deliberately NOT built: any automatic invitation. A Priority-A lead is announced into `info@`
(DAR-82, above) but never auto-invited — that action mints an account and mails a credential-setting
link, so it stays a human decision behind a confirm. The notification exists precisely to put that
decision in front of someone sooner.

## What only the smoke can see (DAR-103)

`pnpm smoke:waitlist` (`scripts/smoke-waitlist.ts`) walks the whole flow against a **real database**.
It is hand-run, like [`smoke:invite`](commands.md#manual-smokes-not-in-ci), and it exists because the
two automated suites each cover a half and neither covers the join:

- **Unit specs** round-trip mint → verify _inside_ one module, with the secret handed in as a
  parameter. Real, and hermetic by construction — no request, no database, no second module.
- **e2e** builds and previews the actual Cloudflare bundle, but with a placeholder `DATABASE_URL`.
  The enrich and the funnel insert swallow their own failures, so they are **no-ops there by design**
  — that is what keeps the suite hermetic and green — and it reaches the token-gated steps through the
  honeypot's decoy token, which addresses no row at all. The continuation token and flow claim are
  asserted only by **shape** in the rendered hidden fields (`/^v1\./`, `/^f1\./`), never by being
  verified by anything.

So the following are observed **nowhere else**, and each is a composition rather than a unit: a step's
`UPDATE` landing on the submission its token names; the load and the four step endpoints agreeing on
the [signing secret](#one-signing-secret-and-it-is-a-type-dar-99) across a real request boundary (the
brand is a compile-time guard, and only for code inside `src` — nothing proves the _running_ worker's
mint and verify agree except a token minted by one and accepted by the other); funnel rows appearing
under the flow the page minted, at most one per `(flow_id, event)` however many times a step is
replayed, and **none** for a flow id the caller invented; DAR-68's budget counting real writes and
then refusing **silently**; DAR-88's append-only insert; `classifyWaitlistLeadGroup` reading what the
steps actually wrote; and DAR-82's `priority_a_notified_at` claiming exactly once.

Four construction decisions are worth keeping.

**It seeds the lead before the first signup.** A genuinely new signup fires two emails — the lead
notification into `info@` and an ack to the submitter — both gated on `isNew`, which is the _lead_
insert winning. Seeding the lead first makes every submission in the run a repeat, so neither send
happens. That is not a dodge around the code under test: a repeat email under an existing lead is
precisely [append-only](#append-only-submissions-dar-88), and it is what the run asserts twice. What
it costs is the `isNew` email gate, which is not observable from outside the process anyway (the only
evidence is mail arriving) and which `waitlist-store.spec.ts` covers.

**A run still sends one email, disclosed rather than suppressed.** The step-4A answers classify
Priority A on purpose, so DAR-82's notification fires once into `info@`. It cannot be separated from
the claim being asserted — `captureWaitlistPriorityLead` checks the Resend key **before** it claims,
so a run that sends nothing is a run where the column was never stamped, and the assertion collapses
into its weaker "already claimed" half. Skipping the send behind an env flag would be DAR-79/DAR-81's
defect again (one script testing two different things depending on whose machine it is on).

**The funnel is anchored by time, not by a parsed handle.** The flow id travels signed and the column
holds the bare UUID, so the obvious way to find a run's rows is to split the handle on `.` and take
the payload. The script deliberately does not: it is a **client**, and a client that can take a signed
value apart is one that will eventually be tempted to put one together. It reads the database's own
clock first (not `Date.now()` — the rows are stamped by SQLite on a Turso host) and asserts that every
funnel row written since belongs to exactly **one** flow. That is a stronger claim than "our rows are
there": it also catches a second flow being minted mid-run, which is DAR-75's `__data.json`
over-count. The cost is that a second person driving `/waitlist` against the same database during the
run makes it fail — it says so when it does.

**It reads every action and hidden field off the page it was handed.** SvelteKit's remote-form action
is `?/remote=<build hash>/<fn>`, so writing one down would make the script need updating after an
unrelated build — and "which form is present" is the honest answer to "which step am I on", since the
step _is_ its form. The one thing it does restate is the answer slugs, which are imported from
`$lib/waitlist-qualification` rather than typed out.

### A negative assertion needs a happens-after, not a sleep

Everything this script asserts on is **fire-and-forget**: the funnel insert, the Priority-A claim and
the notification all run inside `ctx.waitUntil`, which by contract settles _after_ the response. So
"assert that X did **not** happen" read straight after a POST is a race the script wins by accident —
DAR-81's pattern (a guard that passes hardest when nothing has happened yet) in the one place a
`waitUntil` makes it easy to write without noticing.

It shipped that bug twice before it shipped anything else, and both were found by mutation rather than
by reading:

- The first cut reloaded `/waitlist` **before** step 1 and asserted "still one flow, still one view".
  Wrong on the merits — with no resume cookie yet, two arrivals are correctly two flows and two views,
  the floor DAR-66 accepted — and it passed anyway, because the row proving it arrived **235 ms** after
  the read. The reload check now sits **mid-flow**, which is where DAR-75's guarantee actually applies.
- The forged-flow probe asserted zero rows immediately after its POST. Mutating
  `verifyWaitlistFlowId` to accept a bare UUID alongside a signed handle — the exact regression DAR-86
  removed — left that assertion **green**; the run only failed later, on the whole-funnel count, with a
  message about the reload.

The fix is not a longer sleep, which only encodes a duration measured on one machine. It is a
**happens-after anchor**: something the run does _later_, through the same request path into the same
database, whose arrival means the earlier write has had its chance. Both negative claims now anchor on
`use_case_completed` from the step-2 POST that follows them (`settled()`), and the forged probe is
asserted **before** the one-flow count so the failure names itself rather than surfacing as an
off-by-one somewhere else. The Priority-A claim, which has no later event to anchor on, is instead
re-read at the end of the run — a second claim would move the timestamp permanently, so seventeen
intervening round trips are the wait.

### What the mutations proved

Seven, each reverted with the tree asserted clean in between:

| Mutation                                                        | Caught by                          |
| --------------------------------------------------------------- | ---------------------------------- |
| step 2 stops writing `evaluation_timeline`                      | step 2's column check              |
| the budget predicate is dropped from the step `UPDATE`          | the refused write's answer landing |
| `claimPriorityLeadNotification` loses its `IS NULL` guard       | the walk-back's timestamp          |
| `resolveWaitlistFlowId` returns the wire value                  | the **resume**, not the funnel     |
| step 2's capture casts past the `WaitlistFlowId` brand          | the reload anchor never arriving   |
| a bare UUID is accepted alongside a signed handle               | the forged-flow probe              |
| a repeat email edits the newest submission instead of inserting | append-only's row count            |

Two are worth reading twice. Undoing DAR-86's verification breaks the **resume cookie** before it
breaks the funnel, because the signing core splits on `.` and the cookie carries the bare id — the
shape constraint DAR-86 documents, confirming itself from the outside. And casting past the brand at a
single call site takes the whole step funnel silent rather than letting junk through, because
`isWaitlistFlowId` inside the capture is the runtime half that makes the mistake fail **closed**.

Three things it deliberately does **not** cover.

The **restart escape hatch** is thoroughly covered by the hermetic e2e, which can drive it through a
real browser — and exercising it here would mint a second flow and break the one-flow claim above, so
the second signup is POSTed without a fresh GET.

The **client-fired command** (`evaluation_conversation_requested`, `waitlist-funnel.remote.ts`) is the
one funnel surface this leaves alone. It is a remote `command`, not a `form`, so it has no rendered
action to read off the page — reaching it would mean writing down SvelteKit's remote-command wire
format, which is exactly the coupling the "read it off the page" rule exists to avoid. It is also what
lets the final funnel check need no anchor of its own: with that event out of scope,
`qualification_completed` is the last new event the run can produce, so the set is closed once step 4A
has fired and everything after it is a replay.

And the funnel rows a **crashed** run leaves behind cannot be purged: they carry no lead, no address
and no marker, which is exactly the anonymity DAR-66 built in. They are harmless (every query is
anchored to the run's own start), so the script says so rather than adding a column that would make
them findable.

## Setup

`RESEND_API_KEY` (shared with contact) powers the emails; `BETTER_AUTH_SECRET` (already provisioned
for auth) signs the continuation token. No new secret. Schema changes follow the usual
`pnpm db:generate` + committed `drizzle/` migration (drizzle CI gate).

The dev database must be at the current schema before `pnpm smoke:waitlist` can run
(`pnpm db:push`) — a missing column surfaces as a **500 on the signup POST**, since the insert names
every column the schema declares.
