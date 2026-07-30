# Legal pages & data-handling notices

DAR-44. Two content-only routes — `/privacy` (privacy policy) and `/terms` (terms of
service) — plus a one-line notice next to every data-collecting form. Linked from the
footer legal bar (`Footer.svelte`).

## Where things live

- **Pages**: `src/routes/privacy/+page.svelte`, `src/routes/terms/+page.svelte`. No
  loaders; the `/about` mold (CosmicBackdrop + `PageHero` + one divided `glass-card`),
  sections rendered through the shared `LegalSection.svelte`. The contact block is the
  shared `ContactLinks.svelte` (also used by `/about`), fed from `src/lib/site.ts`.
- **Copy**: all Paraglide messages — `privacy_*` and `terms_*` prefixes in
  `messages/en.json` (`es.json` holds only translated keys — none yet, so `/es` falls
  back to the English copy; see [i18n](i18n.md)). The trade name and domain are
  necessarily written into the prose too, so a rename/domain move
  must sweep the `privacy_*`/`terms_*` messages, not just `site.ts`.
- **Dates**: `src/lib/legal.ts` (`PRIVACY_UPDATED` / `TERMS_UPDATED`, ISO) → the shared
  `legal_updated` message's `{date}` param, formatted per-locale via `formatDate` — one
  constant per document, so the en/es copies of a page can never disagree and
  translators never touch a date.
- **Notices**: the shared `FormPrivacyNotice.svelte` next to each submit —
  `ContactFields.svelte` (one spot covers BOTH the contact modal and `/contact`; it
  passes `onLinkClick` to close the global dialog so the layout-mounted modal can't
  linger over `/privacy` after a client-side navigation) and `waitlist/+page.svelte`.
  `signup/+page.svelte` renders its own two-link agreement line using the same exported
  `inlineLinkClass`. e2e smokes live with each surface: `{privacy,terms}` pin the
  footer links + section headings; `{contact,signup,waitlist}` each pin their own
  notice link.

## Rules

- **Any new data-collecting form gets a notice** — add a `*_privacy_notice` +
  `*_privacy_link` message pair and drop `<FormPrivacyNotice … />` next to its submit.
- **Keep the policy truthful to the code.** The privacy page enumerates what each form
  actually stores — including the user-agent + hashed IP saved with contact/waitlist
  submissions, the optional waitlist qualification answers (value/budget ranges are
  internal-only: never shown back, never published), and the message→account backfill — plus the sign-in audit log, the
  **two** essential cookies (the sign-in one, and DAR-75's `waitlist_resume`, which remembers
  which step of the waitlist form you reached; locale still lives in the URL, and there is no
  language cookie), the honest
  no-automatic-expiry status of security logs, and the four processors (Cloudflare,
  Turso, Resend, Sanity — Sanity is content-only and never sees form data). If a form
  gains a field, a processor appears, **a cookie appears**, or logging/linking/retention
  changes, update the matching `privacy_*` message **and** bump that page's date constant
  in `src/lib/legal.ts`. The cookie sentence is the easiest one to falsify by accident —
  it enumerates every cookie the site sets, so a new one makes the page untrue the day it
  ships.
- **"How we use it" names two categories of email, and the second is a promise about what we
  DON'T send** (DAR-121). It used to be one paragraph ending "waitlist email is only about
  early access", which the step-1 opt-in box ("Send me occasional DarcStar product and
  research updates") and the policy's own collection section both contradicted. Now:
  _operational_ mail — confirmation, invitation, account — sent because the person asked;
  and _optional product and research updates_, which `consent_updates` alone never authorizes,
  being an unverified single-opt-in claim from an unauthenticated form
  ([waitlist](waitlist.md#consent)).
- **DAR-139 built the gate the policy describes, so the paragraph changed with it.** Ticking
  the box now causes exactly one email — a confirmation request — and
  `privacy_use_updates_body` says so, because that is a send the site did not make before. It
  also states what still hasn't changed: **we are still not sending product and research
  updates**, nothing goes out unless the confirmation is answered, we ask at most once a day
  however many times the form is filled in, and every message including that one carries a link
  that stops us without signing in. `privacy_collect_waitlist_body` lost its "a preference we
  record but don't act on yet", and `privacy_use_operational_body` points down at the new
  paragraph rather than describing the confirmation twice — two paragraphs enumerating one email
  is how they drift. `PRIVACY_UPDATED` moved with all three.
- **DAR-191 made an older promise in that same paragraph true.** `privacy_use_operational_body`
  already said early-access mail "isn't a marketing list, and you can ask us to take you off it at
  any time" — a promise whose only mechanism was an operator remembering, which is not a mechanism.
  It now reads that we **record** the request against the entry, and adds the thing a reader could
  not previously tell: that being left alone does not require having your record deleted. That
  distinction is the point of the change, since deletion was the only vocabulary the page implied and
  the only vocabulary `/admin/waitlist` had. The paragraph also now says optional updates are a
  **separate** choice, because the flag deliberately does not cancel a subscription the mailbox
  confirmed ([waitlist](waitlist.md#outreach-dont-contact-me-dar-191)).
- **The tripwire survived the ticket and was re-aimed.**
  `src/lib/server/email-senders.spec.ts` holds every module that imports `postEmail` — in `src`
  **and in `scripts/`**, since a hand-run blast is how a first send would realistically get
  written — against an allowlist where each declares what it sends. DAR-139's confirmation
  request is declared `operational` (a question, not a use of the answer), so the `marketing`
  assertion is still armed for the send nobody has written. Its failure message used to say "go
  and build double opt-in"; that now exists, so it says instead that being declared there is not
  authorization, and names `readUpdatesAudience` as the only definition of who may receive one.
  A tripwire that tells you to build what is already there is one people learn to click past.
- **That allowlist also constrains where mail code may be FACTORED** (DAR-181), which is not obvious until
  someone tries to deduplicate the mailers. It is keyed on which file imports `postEmail`, with a
  per-call-site `sends` count, so a shared helper must never wrap the send: the three transactional
  link emails share a **layout** (`link-email.ts` — they were byte-identical apart from an eight-key
  message prefix) and the two fan-outs share their `allSettled` control flow (`settleSends`), but
  neither shared module touches `postEmail`. Centralizing it would collapse **seven** declared
  senders into one and reinstate DAR-102's "a send appended inside an already-listed file inherits
  that file's pass" — the per-file `kind` is what makes "we send no marketing" contradictable by a
  diff, and it says nothing once there is a single file to declare. DAR-139's confirmation request
  is deliberately **not** folded into that shared layout: it takes two links rather than one, sends
  no greeting by name on purpose (the submitter and the recipient may be different people), carries
  auto-reply headers, and has no "if you didn't ask for this" line — so it shares the shell's
  markup but not its shape, and forcing it in would make the template configurable rather than
  shared. Unifying that remaining shell markup is a real open question, not an oversight.
- **Settled public facts only** (see the About page): trade name only — no LLC/Inc —
  location "United States", contact via GitHub + email. Because no state is on record,
  the terms deliberately carry **no governing-law state clause**; add one if the entity
  registers a state. The policies are plain-language and were not reviewed by a lawyer.
