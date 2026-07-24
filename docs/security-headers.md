# Security response headers

Added for DAR-45. **Worker responses** (every SSR'd page, the auth API, remote functions) carry
CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and clickjacking
protection (`frame-ancestors` + `X-Frame-Options`). **Static-asset responses** carry only
`X-Content-Type-Options` + HSTS — assets don't execute in a document context, so the rest doesn't
apply to them. The set is delivered from **three places** — know which one you're editing (shared
values live in `src/lib/security-headers.ts`; the plaintext `_headers` is the one hand-synced
copy):

| Surface                                                         | Where it's set                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Content-Security-Policy (SSR pages)                             | SvelteKit `csp` config — `sveltekit({ csp })` in `vite.config.ts`      |
| All other headers on worker responses (pages, auth API, remote) | `handleSecurityHeaders` in `src/hooks.server.ts` (first in `sequence`) |
| Static assets (`/_app/*`, `robots.txt`, …)                      | Project-root **`_headers`** file, served by the Workers assets layer   |

## CSP

Kit owns the CSP because its inline hydration bootstrap needs the per-response **nonce** Kit
injects — a hook-built header can't know it. The policy is **enforced** (not report-only), on the
strength of `src/routes/security-headers.e2e.ts`, which drives the real Workers runtime and fails
on any `securitypolicyviolation` event. Its teeth come from four mechanisms:

- a violation guard over every public path (including `/es`), asserting the worker header set on
  each — so a page that starts prerendering (served by the assets layer, CSP demoted to a
  `<meta>` tag that can't carry `frame-ancestors`) fails the suite instead of silently degrading;
- the **live Turnstile widget** on `/signup`: `pnpm preview` bakes Cloudflare's always-pass
  **test** sitekey (`1x00000000000000000000AA`, `--var` in package.json), because a real sitekey
  rejects localhost with a 400 before rendering — the test key runs the real challenge pipeline
  anywhere, proving `script-src` live (the widget's iframe hides inside a **closed shadow root**,
  so the e2e keys on the `cf-turnstile-response` input it injects; `frame-src` is pinned by the
  synthetic probe);
- **synthetic probes** that inject a script/iframe/image from each allowlisted origin — CSP blocks
  fire at request-attempt time, before any network I/O, so this works with no Sanity token or
  content;
- a **negative control** that injects a non-allowlisted script and asserts the violation IS
  captured, so the collector can't rot into a vacuous pass.

Current allowlist and why:

- `script-src 'self' https://challenges.cloudflare.com` + nonce — Kit bundles + inline bootstrap;
  Turnstile's `api.js` on `/signup`.
- `frame-src https://challenges.cloudflare.com` — the Turnstile widget iframe.
- `img-src 'self' data: https://cdn.sanity.io` — Sanity image CDN; `data:` for
  `@tailwindcss/forms`' inline-SVG chevrons/checkmarks.
- `font-src 'self' data:` — fonts are self-hosted (Fontsource), but **Vite inlines assets under
  4KB as `data:` URIs**, and the small JetBrains Mono subsets clear that bar.
- `style-src 'self' 'unsafe-inline'` — required: Svelte transitions inject `<style>` elements at
  runtime and SSR'd `style=` attributes can't be nonced. Kit deliberately skips style nonces when
  `unsafe-inline` is present (a nonce would make browsers ignore it). Scripts stay strict.
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `default-src 'self'`, `connect-src 'self'`.

**Adding a third-party origin** (script, image host, iframe, analytics): add it to the matching
directive in `vite.config.ts` (put the origin constant in `src/lib/security-headers.ts` if app
code also references it) and add a synthetic probe for it in `security-headers.e2e.ts`. If you
forget the directive, the violation guard fails with the blocked directive + URI in the diff.

**If a page ever prerenders**: Kit ships the CSP as a `<meta http-equiv>` tag there, which cannot
carry `frame-ancestors` — and prerendered pages are served by the assets layer, skipping the hook
entirely. The e2e suite pins this invariant structurally (every audited path asserts the worker
header set), so prerendering an audited page fails the suite; revisit `_headers` before
prerendering anything.

## Non-CSP headers (the hook)

`handleSecurityHeaders` sets, on every worker response:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — **no `preload`** on purpose:
  preload-list submission is a hard-to-reverse commitment; add it deliberately if ever wanted.
  Browsers ignore HSTS over plain HTTP, so localhost dev/preview is unaffected.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` denying the powerful-feature APIs the site doesn't use (camera, mic,
  geolocation, …). Turnstile needs none of them. This is a **fixed denylist** — the header has no
  forward-compatible deny-all, so features it doesn't enumerate default to allowed; revisit the
  list when adopting new browser APIs (e.g. WebAuthn → grant `publickey-credentials-get` here
  explicitly).
- `X-Frame-Options: DENY` — legacy fallback for `frame-ancestors 'none'`.

### Known gaps (accepted)

Two niche worker paths bypass the hook; both were weighed and accepted:

- **Fatal errors inside the hook chain itself** (e.g. the session DB read throwing on `/admin`)
  unwind past `resolve()`, so Kit's last-resort 500 page ships without these headers. Error pages
  carry no sensitive body; not worth wrapping the hook in try/catch.
- **Kit's 304 rebuild** copies only a fixed header whitelist (etag, cache-control, …), dropping
  the security headers. Unreachable today: the per-response CSP nonce makes page ETags unstable,
  so `If-None-Match` never matches — but it becomes live if a `+server.ts` ever emits a stable
  ETag on a 200.

Dev-only note: the CSP is enforced during `vite dev` too. Plain-localhost HMR is fine
(`connect-src 'self'` covers the same-origin websocket), but `vite dev --host` or a custom
`server.hmr` proxy can put the HMR websocket outside `'self'` and silently kill live-reload — if
HMR dies in an exotic dev setup, that's why.

## Static assets — the `_headers` file

Workers static assets are served **before the worker runs**, so `hooks.server.ts` never sees them.
The project-root `_headers` file (nosniff + HSTS on `/*`) is their only header path — keep it in
sync with the hook. Gotchas learned the hard way:

- It must live in the **project root**, not `static/` — `@sveltejs/adapter-cloudflare` errors on a
  `static/_headers` at build time. The adapter copies it to `.svelte-kit/cloudflare/_headers` and
  appends its own autogenerated immutable-cache block below yours.
- The file itself is not publicly served (asserted in e2e: `/_headers` → 404).

## Verifying

`pnpm test:e2e` covers all of it (header assertions + violation guard, real Workers runtime).
Manually: `pnpm preview`, then `curl -sI localhost:4173/` (worker path) and
`curl -sI localhost:4173/robots.txt` (assets path).
