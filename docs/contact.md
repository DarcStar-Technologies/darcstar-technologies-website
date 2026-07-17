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

## Database

`contact_submission` (`id`, `name`, `email`, `company?`, `interest?`, `message`, `ip_hash?`, `user_agent?`, `created_at`). Applied to Turso with **`pnpm db:push`** (this repo is schema-first — no migrations dir). The deployed Worker and local dev share the one Turso DB, so the table only needs pushing once. Read submissions with `pnpm db:studio` until an admin UI / notification lands.

## Tests

Three layers, so a regression fails fast at the cheapest one:

- **Unit** (`server` project) — `src/lib/server/contact.spec.ts` covers `validateContact` (every field rule, trim, optional/unknown-interest coercion) and `hashIp`.
- **Component** (`client`/browser project) — `GlassSelect.svelte.test.ts` (via `GlassSelectHarness.svelte`) asserts the dropdown's contract: renders options, click/keyboard selection binds the slug into the hidden input, and reopening reflects the selection. `ContactDialog.svelte.test.ts` asserts the modal opens from the `contactDialog` rune, renders the intake fields, and keeps the honeypot hidden + out of the a11y tree.
- **e2e** (`src/routes/page.svelte.e2e.ts`) — the CTA opens the modal and Escape closes it, against the built Cloudflare worker.

The happy-path submit (validation → Turso) is exercised manually rather than in CI, to avoid writing to the production DB.

## Follow-ups (filed separately)

Email/lead notification on submit; Cloudflare Turnstile (stronger than the honeypot); a `hello@` role alias to replace the personal address; optionally a `/contact` no-JS fallback page and an in-app admin view.
