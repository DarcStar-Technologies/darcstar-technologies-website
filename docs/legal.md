# Legal pages & data-handling notices

DAR-44. Two content-only routes — `/privacy` (privacy policy) and `/terms` (terms of
service) — plus a one-line notice next to every data-collecting form. Linked from the
footer legal bar (`Footer.svelte`).

## Where things live

- **Pages**: `src/routes/privacy/+page.svelte`, `src/routes/terms/+page.svelte`. No
  loaders; the `/about` mold (CosmicBackdrop + `PageHero` + one divided `glass-card`).
- **Copy**: all Paraglide messages — `privacy_*` and `terms_*` prefixes in
  `messages/en.json` (`es.json` mirrors en until it's really translated). Company facts
  render from `src/lib/site.ts` (`{expr}` mustaches), never re-typed.
- **Notices**: `ContactFields.svelte` (one spot covers BOTH the contact modal and the
  standalone `/contact` page), `waitlist/+page.svelte`, and `signup/+page.svelte`
  (agreement line linking `/terms` + `/privacy`). e2e smokes in
  `src/routes/{privacy,terms}/page.svelte.e2e.ts` pin the footer links, section
  headings, and each notice link.

## Rules

- **Any new data-collecting form gets a notice** — a short `*_privacy_notice` +
  `*_privacy_link` message pair next to its submit, linking `localizeHref('/privacy')`.
- **Keep the policy truthful to the code.** The privacy page enumerates what each form
  collects, the security logging (sign-in IP/UA, per-IP rate limits), the
  essential-only cookies, and the four processors (Cloudflare, Turso, Resend, Sanity —
  Sanity is content-only and never sees form data). If a form gains a field, a new
  processor appears, or logging changes, update the matching `privacy_*` message **and**
  bump the `privacy_updated` / `terms_updated` date messages.
- **Settled public facts only** (see the About page): trade name only — no LLC/Inc —
  location "United States", contact via GitHub + email. Because no state is on record,
  the terms deliberately carry **no governing-law state clause**; add one if the entity
  registers a state. The policies are plain-language and were not reviewed by a lawyer.
