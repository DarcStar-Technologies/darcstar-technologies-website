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
  `messages/en.json` (`es.json` mirrors en until it's really translated). The trade
  name and domain are necessarily written into the prose too, so a rename/domain move
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
  submissions, the public (≥3-people) waitlist interest suggestions, and the
  message→account backfill — plus the sign-in audit log, the sign-in-cookies-only
  cookie story (locale lives in the URL; there is no language cookie), the honest
  no-automatic-expiry status of security logs, and the four processors (Cloudflare,
  Turso, Resend, Sanity — Sanity is content-only and never sees form data). If a form
  gains a field, a processor appears, or logging/linking/retention changes, update the
  matching `privacy_*` message **and** bump that page's date constant in
  `src/lib/legal.ts`.
- **Settled public facts only** (see the About page): trade name only — no LLC/Inc —
  location "United States", contact via GitHub + email. Because no state is on record,
  the terms deliberately carry **no governing-law state clause**; add one if the entity
  registers a state. The policies are plain-language and were not reviewed by a lawyer.
