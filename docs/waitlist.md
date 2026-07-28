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
- **Emails gated on `isNew`** — a lead → `info@` and a localized signer ack, fire-and-forget via
  `ctx.waitUntil`. This is the mailbomb guard, and append-only makes it **more** load-bearing, not
  less: every submit now inserts a row, so "a row was created" is no longer any evidence of a new
  person. `isNew` is the LEAD insert winning — the only thing that means "we have never mailed this
  address".
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
1 and the page load), so `waitlist-funnel.spec.ts` reads `waitlist-steps.remote.ts` and pins two
things: the **import** — a call site cannot exist without the binding, and pinning the import rather
than the call text can't be tripped by a comment naming the ungated function — and at least one gated
call per exported step form, so a fifth step can't quietly under-report.

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
- **Filter chips** are plain links over a `?class=` GET, so filtering works without JS and every view
  is bookmarkable. Counts are over the whole window, not the filtered slice, so the shape of the list
  stays visible while a filter is on. An unrecognized `?class=` is "no filter", never an error.
- **Summary columns** read the **newest** submission — the most recent thing this person told us —
  rather than an aggregate, because an aggregate would have to choose. Where the choice would have
  mattered, the conflict chip says so and the detail shows every value.
- **Outreach column** — `contact_permission` rendered as the tri-state it is: `null` = never asked
  (the pilot answer wasn't positive), `false` = asked and declined, `true` = granted (the only one
  with a filled badge). A grant and a decline under one address is a flagged conflict, which is the
  honest reading of it.
- **Row detail** — a no-JS `<details>` per lead listing **every submission**, newest first, each with
  its own timestamp, priority band, delete control, and a complete answer grid (region, consent +
  when, application, timeline, approach, impact, budget, adoption evidence, pilot interest, deployment
  scale, contact method, phone, research preferences, reached step, last updated) plus the retired v1
  columns for historical rows. Two submissions show two complete sets, never a reconciled one. `role`
  resolves against BOTH label sets (v1 slugs survive as history), falling back to the raw slug so
  nothing renders blank. The lead's own state (invited / activated / reviewed by) sits below them,
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

## Setup

`RESEND_API_KEY` (shared with contact) powers the emails; `BETTER_AUTH_SECRET` (already provisioned
for auth) signs the continuation token. No new secret. Schema changes follow the usual
`pnpm db:generate` + committed `drizzle/` migration (drizzle CI gate).
