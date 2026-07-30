# CRM egress — contact submissions → `crm-ingest`

What this repo does: a committed `contact_submission` row becomes one versioned `ContactSignal` on the
**`crm-ingest`** queue. That is the whole of it. Everything downstream — resolving the signal into a
contact, deduping, the one-way export to Twenty — lives in **[crm-service](https://github.com/DarcStar-Technologies/crm-service)**
and is not this repo's business (DAR-136).

The site imports **no CRM code**. It never did: the inline `website_form` connector call DAR-136's
description opens with was planned and never built here, so this ticket added a producer rather than
replacing anything.

## The pieces

| File                                   | Role                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/server/crm/contact-signal.ts` | The hand-copied contract. CRM-owned shape; we compile against it.   |
| `src/lib/server/crm/queue.ts`          | `postContactSignal` — **the only file that may name `CRM_INGEST`.** |
| `src/lib/server/crm/contact-lead.ts`   | Builds the website-form signal and hands it over, fire-and-forget.  |
| `src/lib/contact.remote.ts`            | The one call site, beside the Resend fan-out.                       |

## Why a queue, not a service binding

DAR-34's choice, and it constrains the code: the write has to survive the CRM being **down**, and
`ctx.waitUntil` only extends ~30s past the response. An RPC into an unhealthy CRM inside that budget
is a lost signal; an enqueued message is not. So `queue.ts` deliberately knows nothing about CRM
health and has nothing to retry — redelivery, a DLQ and a drain plan are all consumer-side (DAR-135).

A missed produce is also not a disaster: the CRM's reconcile sweep re-reads `contact_submission` and
stays **authoritative over the queue**. This is an accelerator, not a system of record.

## The posture, which is the emails' posture

The row is committed before the produce runs, so a queue failure **must never fail the submission** —
it is logged against the row id (never the address; the line goes to Workers Logs) and dropped.
`captureContactLead` returns `void` for DAR-66's reason: no caller should be able to await egress.

It is reached only on the genuine-insert path, past the honeypot and the IP throttle, so a bot cannot
enqueue — exactly as it cannot trigger the acknowledgement email.

## Preview produces to nothing, and that is the isolation

`wrangler.jsonc` declares `queues.producers` at the **top level only**. Bindings are non-inheritable
in wrangler, so `[env.preview]` gets no `CRM_INGEST` and `platform.env.CRM_INGEST` is `undefined`
there. DAR-136's acceptance criterion asked for "preview and prod produce to different queues"; there
is no second queue to produce to, because the CRM has **no preview environment** (deliberately — see
its `wrangler.jsonc`), and aiming preview at `crm-ingest` would put test submissions in the real
contact graph and thence in Twenty. So a preview submission persists to `contact_submission` and never
reaches the CRM, which is what should happen to test data.

Declaring the binding in one environment also earns a compile-time guard, **measured** rather than
assumed: one env yields `CRM_INGEST?: Queue` (optional, and absent from `Cloudflare.PreviewEnv`),
both envs yield a required `CRM_INGEST: Queue`. The omission is what forces callers to handle absence.

In development the queue is **simulated**: `pnpm preview` and the e2e run go through `wrangler dev`,
whose default is local mode, and nothing passes `--remote`. So a submit against a local build enqueues
nothing that leaves the machine.

`preview-worker.spec.ts` pins both halves. Nothing breaks loudly if that drifts — adding `queues` to
the preview env silently starts filing every preview submission as a real lead and `pnpm check` stays
green.

## What leaves this Worker, and the two promises on `/privacy`

The signal carries a **name, an email address and a company**. There is no `message`, no `interest`,
no IP and no user agent, because the contract has no field for them — a producer that wanted to send
the message body would have to widen the contract in the other repo, past its consumer's validator.
That is what `privacy_processors_twenty_body` leans on when it says Twenty never receives your
message.

`/privacy` names **Twenty as a fifth processor**, added in the same commit as the produce. Shipping the
egress ahead of the disclosure is DAR-121's defect; shipping the disclosure ahead of the egress
describes a system we don't have. Two of that entry's claims are guarded by `crm-egress.spec.ts`:

1. **the message never leaves** — structural, asserted as the built signal's exact key set (a
   `not.toContain('message')` would pass against a signal that grew `interest` or `ipHash`);
2. **waitlist entries are not produced at all** — a claim about absent code, held by an allowlist with
   one entry, exactly as `email-senders.spec.ts` holds "we send no marketing".

`postContactSignal` takes `platform` and resolves the binding **itself** rather than accepting a
`Queue`, and that is what makes the chokepoint real: the binding is the only handle on the queue that
exists, so "one file names it" is strictly stronger than "one file calls `.send()`" — a caller handed
a `Queue` would satisfy the second and walk past the first. Mutation-verified: a producer that
resolves the binding for itself imports nothing and is caught only by the binding rule.

### The chokepoint is not the only door

A guard on `postContactSignal` says nothing about who may reach the function that **calls** it, and a
producer's whole job is to be callable. Measured, not reasoned about: a waitlist producer importing
`captureContactLead` — touching neither the queue module nor the binding — passed **every assertion
in this file** (26 of them at the time) while sending waitlist entries to the CRM as `website_form`
signals.

It is also the _likely_ mistake rather than a contrived one. Whoever builds DAR-177 will read this
producer first, and a waitlist row has an id and a `created_at`, so it satisfies `ContactLead` without
complaint. Hence each producer declares its public **entry point** and exactly **who may call it**,
two-sided so a removed call site fails too.

The rule for a new call site: declare it — and if what it hands over is not what that producer says it
sends, write a new producer rather than widening an existing one.

That second allowlist is **per file** where `sends` is per call site, which is deliberate rather than
an oversight: what it protects is which _subsystem_ reaches a producer, and every file holding a
waitlist row is a file not on the list, so a waitlist entry cannot get there without a new name
appearing. A second call from an already-declared file is a much smaller thing — another signal for a
row that file already legitimately has.

## What the version field does NOT cover

Every message carries `v`, so a producer running ahead of the consumer is a _rejected known version_
in `crm_dead_letter` rather than a half-populated contact. That covers the **shape**.

It does not cover the **vocabulary**. `source` is validated against a registry in the other repo, so
renaming `website_form` there would leave this file compiling while every message dead-lettered as
`malformed`. A hand copy cannot catch that. It is the one drift the `v` discipline does not answer,
and the failure is at least loud and inspectable CRM-side.

The copy is deliberately **narrow** — one source key and one identity platform, where the CRM's
registry holds eight and six. A faithful copy of a vocabulary we never emit is drift surface bought
for nothing; narrowing makes "the website can only ever claim to be the website form" a compiler fact.

Until DAR-84 settles the cross-repo mechanism for `@darcstar-technologies/*` packages, the hand copy
plus `v` **is** the mechanism. Whatever DAR-84 lands on becomes binding here too — don't invent a
second one.

## The waitlist half is deferred, on purpose

DAR-136 scoped in "also produce for waitlist submissions". It is not built, because the CRM's `SOURCES`
registry has no `waitlist` key and `isSourceKey` is the consumer's validator — such a signal would
dead-letter as `malformed` on arrival. The **consumer owns the vocabulary and deploys first**.

Reusing `website_form` was rejected: an operator could no longer tell a person who wrote to us from
one who joined a waitlist, and `sourceRef` would be ambiguous about which table to look in.

Left open on the ticket, and it is the more interesting half: whether a signup should reach the
contact graph **before the person is invited**. A waitlist address is unverified — anyone can type
somebody else's in, which is the premise DAR-139's whole consent gate rests on — so producing on every
submit would put strangers' addresses in front of a third party. `invited_at` is a human decision and
is the obvious alternative trigger.

## Honest residuals

- **The call site is not tested**, and two separate things stop a suite reaching it. No e2e submits
  the contact form at all — they open the modal and assert the dialog, because the happy-path submit
  has always been exercised by hand rather than in CI to avoid writing rows (see
  [contact.md](contact.md) → Tests). And in CI it could not succeed anyway: `test.yml` writes
  `DATABASE_URL=libsql://placeholder.invalid`, so the throttle `SELECT` throws long before the
  insert. So `contact.remote.ts` handing over the row's own id and `created_at` — rather than a fresh
  uuid or produce-time, which is what makes redelivery free — is pinned only one layer down, in
  `buildContactLeadSignal`'s spec, and the wiring itself is review territory.
  What that residual does NOT cover is a synchronous throw out of the build: `captureContactLead`
  builds inside the promise chain precisely so a bad caller cannot 500 a submission whose row is
  already committed, and that is mutation-verified.
- **A name may not reach Twenty at all.** We send `displayName`; the CRM's resolver stores
  `displayName`/`givenName`/`familyName` separately and its Twenty export reads only the latter two,
  so a contact-form Person currently lands there with an email and no name. The contact form collects
  one name field and splitting it on a space is wrong often enough to be worse than nothing, so the
  fix belongs CRM-side (a `displayName` fallback in `exportContact`) and is filed. `/privacy` states
  the design — name and email — which is the conservative direction for a disclosure.
