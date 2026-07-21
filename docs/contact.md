# Contact form (issue #11)

Replaces the personal `mailto:` CTAs with a modal contact form that persists to Turso.

## Flow

- **Triggers** — the hero "Get in touch →" and the CTA-section "Contact Us" (both in `src/routes/+page.svelte`) and the footer "Contact" link (`src/lib/components/Footer.svelte`) are `<button>`s that call `contactDialog.show()`. The footer email _icon_ stays a direct `mailto:` fallback.
- **Shared state** — `src/lib/contact-dialog.svelte.ts` exports a `contactDialog` runes singleton (`open` + `show()`/`close()`), the same pattern as `paraglide.svelte.ts`. One dialog, many triggers.
- **Dialog** — `src/lib/components/ContactDialog.svelte` (Skeleton `<Dialog>`, headless → styled with `glass-panel`), rendered **once** in `+layout.svelte`. Skeleton provides focus-trap, scroll-lock, Esc, and outside-click close; `z-[60]` clears the header (`z-50`) and scrim (`z-40`). Fields use the reusable **`glass-field`** utility (recessed/beveled/grainy wells carved into the panel — not Skeleton `.input`, whose Windows bugfix forces an opaque fill). The interest picker is **`GlassSelect.svelte`**, built on the maintained **Zag `@zag-js/select`** state machine (via `@zag-js/svelte` — the same headless engine Skeleton wraps for its own components) instead of a native `<select>`. Zag owns keyboard nav, ARIA, focus, typeahead, and popper positioning; we style the parts (`getTriggerProps` → a `glass-field` button, `getContentProps` → a `surface`/backdrop-blur popup, `getItemProps` → a `primary`-tinted highlight + check). Its value flows `onValueChange` → a `$bindable` → a hidden input into the form's FormData. One gotcha: Zag sets the positioner's `z-index` inline, so it's lifted via `mergeProps` above the form's `glass-btn` (whose `backdrop-filter` is a competing z-auto stacking context). (`color-scheme: dark` on `<html>` still darkens the _other_ native controls — scrollbars, autofill.) Errors use `text-error-400`, success `text-success-400` (WCAG floors, see [styling](styling.md)).
- **Submission** — the form spreads `submitContact` from `src/lib/contact.remote.ts`, a SvelteKit **remote `form`** function (needs `kit.experimental.remoteFunctions`, already enabled in `vite.config.ts`). It progressively enhances; same-origin CSRF is enforced by SvelteKit. All copy is Paraglide messages (`contact_*`), guarded by the `local/no-raw-text` rule.

## Server (`src/lib/contact.remote.ts`)

`submitContact = form('unchecked', …)`:

1. Grabs `getDb()` + `getRequestEvent()` **before any `await`** (workerd `platform.env` is request-scoped and `getRequestEvent()` must precede the first await).
2. **Honeypot** — a hidden, off-screen `website` field; if filled, silently returns success **without** persisting (don't reveal the trap).
3. **Validation** — `validateContact` (`src/lib/server/contact.ts`, a pure fn, unit-tested in `contact.spec.ts`); failures throw `invalid(issue.field(m.contact_error_*()))` → per-field `.issues()` in the UI. Interest slugs live in the client-safe `src/lib/contact-interests.ts` (single source shared with the `<option>`s and the server validator).
4. **Throttle** — ≤5 submissions per hashed IP per hour. `hashIp` is a truncated SHA-256 — the raw address is **never** stored — backed by the `(ip_hash, created_at)` index.
5. **Insert** — `contact_submission` (`src/lib/server/db/schema.ts`).
6. **Notify** (issue #52) — after the insert, `sendLeadNotification` (`src/lib/server/contact-notify.ts`) emails the lead to `info@` so it's actionable without polling the DB. See below.

## Lead notification (`src/lib/server/contact-notify.ts`)

- **Provider — Resend** (a plain HTTPS `POST https://api.resend.com/emails` reachable from workerd via `fetch`; **no npm SDK**). MailChannels' free Workers relay ended in 2024, so it wasn't viable.
- **Fire-and-forget** — the row is already persisted, so a send failure must never fail the submission. `submitContact` grabs `event.platform` **before the first await**, then after the insert schedules `platform.ctx.waitUntil(sendLeadNotification(key, cleaned).catch(console.error))`. `waitUntil` keeps the Worker alive until the send resolves _after_ the response returns; with no `RESEND_API_KEY` (unconfigured) or no `ctx` (`vite dev`) it simply skips. The visitor's response never waits on email.
- **Shape** — `buildLeadEmail(sub)` (pure, unit-tested in `contact-notify.spec.ts`) renders subject + text/html from a `CleanedContact`. **From/To = `info@darcstar.tech`** (the #54 role alias); **Reply-To = the visitor's address**, so replying in Gmail goes straight to the lead. Interest slug → human label via a plain map mirroring `contact_interest_*` (server ops output is English, outside the `no-raw-text` rule). All visitor content is **HTML-escaped** in the HTML body.
- **Infra (not in the repo)** — `darcstar.tech` must be verified in Resend (DKIM/SPF DNS records) and `RESEND_API_KEY` set locally (`.env`) and in prod (`wrangler secret put RESEND_API_KEY`) before real mail sends. See [deployment](deployment.md).
- **Deliverability (verified 2026-07-21)** — `darcstar.tech` is verified in Resend (DKIM/SPF, `us-east-1`, sending enabled). Live test sends to a Google Workspace mailbox on the domain all returned Resend status `delivered` **and landed in the inbox, not spam** — both a bare `no-reply@darcstar.tech` and a header-enhanced variant (`DarcStar <no-reply@darcstar.tech>` display name + `Reply-To: info@darcstar.tech` + `List-Unsubscribe: <mailto:…>` with one-click). So the domain's authentication is trusted by Gmail; the extra headers weren't _needed_ to reach the inbox here, though they remain good practice for real bulk sends (and a real `unsubscribe@` mailbox would be required — inbound receiving is currently disabled on the domain). Caveat: Resend's `delivered` status only confirms the receiving server _accepted_ the message; inbox-vs-spam placement isn't reported back and must be confirmed in the mailbox.

## Standalone page (`/contact`, issue #55)

A shareable, no-JS fallback for the modal, at `src/routes/contact/+page.svelte`. It spreads the **same** `submitContact` remote form, so it progressively enhances when JS is present and degrades to a native POST otherwise: on success the reloaded page renders `submitContact.result`, and validation errors + repopulated values come back through the fields' `.issues()`/`.as()` during SSR (no custom `enhance` — the default enhancement + native fallback are exactly what a fallback page wants). The interest picker is a **native `<select>`** here — the modal's `GlassSelect` is a JS-only Zag component, so it can't be the no-JS control — styled by the shared `glass-field` utility (its opaque fill was tuned to match a native select under `color-scheme: dark`, so no extra CSS). Reuses every `contact_*` message + the `INTERESTS` single-source; the page-only copy is `contact_page_*`.

The global `ContactDialog` (rendered once in the layout) keeps its own copy of the contact form mounted-but-hidden and portaled **outside `<main>`**, so on this route two `<form>`s with the same remote action exist in the DOM — the e2e selectors scope to `<main>` to disambiguate. e2e (`src/routes/contact/page.svelte.e2e.ts`): the page renders with JS, and falls back to a native POST without JS (`javaScriptEnabled: false`, asserting `method`/`action`) — no live submit, to avoid writing to the prod DB.

## Database

`contact_submission` (`id`, `name`, `email`, `company?`, `interest?`, `message`, `ip_hash?`, `user_agent?`, `created_at`). Applied to Turso with **`pnpm db:push`** (the default apply path; a versioned `drizzle/` migration trail also exists — see [deployment.md](deployment.md)). The deployed Worker and local dev share the one Turso DB, so the table only needs pushing once. Leads also arrive by email on submit (see Lead notification above); the gated **`/admin`** view (#69, see [auth.md](auth.md)) is the in-app triage surface, with `pnpm db:studio` as the full archive.

## Tests

Three layers, so a regression fails fast at the cheapest one:

- **Unit** (`server` project) — `src/lib/server/contact.spec.ts` covers `validateContact` (every field rule, trim, optional/unknown-interest coercion) and `hashIp`; `src/lib/server/contact-notify.spec.ts` covers `buildLeadEmail` (subject, per-field body, interest-label map, HTML escaping) and `sendLeadNotification` (Resend payload + non-2xx throws, via a stubbed `fetch`).
- **Component** (`client`/browser project) — `GlassSelect.svelte.test.ts` (via `GlassSelectHarness.svelte`) asserts the dropdown's contract: renders options, click/keyboard selection binds the slug into the hidden input, and reopening reflects the selection. `ContactDialog.svelte.test.ts` asserts the modal opens from the `contactDialog` rune, renders the intake fields, and keeps the honeypot hidden + out of the a11y tree.
- **e2e** (`src/routes/page.svelte.e2e.ts`) — the CTA opens the modal and Escape closes it, against the built Cloudflare worker.

The happy-path submit (validation → Turso) is exercised manually rather than in CI, to avoid writing to the production DB.

## Follow-ups (filed separately)

Cloudflare Turnstile (#53, stronger than the honeypot). ✅ Lead notification on submit (#52), the `info@` role alias (#54), the `/contact` no-JS fallback page (#55), and the gated `/admin` submissions view (#69, see [auth.md](auth.md)) shipped.
