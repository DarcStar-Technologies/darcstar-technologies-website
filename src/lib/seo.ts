// Relative (not $lib) import: seo.e2e.ts imports this module under Playwright's transform,
// which resolves relative paths unconditionally — same reason security-headers.ts is alias-free.
import { baseLocale, type Locale } from './paraglide/runtime';

// Locales whose copy is genuinely translated. `es` is wired but untranslated — `messages/es.json`
// carries translated keys only and is empty today (DAR-53), so every string falls back to `en` and
// /es is a duplicate of the English tree (issue #18). It is therefore NOT listed. This ONE flag
// drives every "is this locale real?" decision: Seo.svelte's noindex + og:locale:alternate loop
// (and, later, its hreflang set), and the /sitemap.xml URL set (untranslated locale trees stay out
// of the sitemap — they're noindex).
//
// Add 'es' here the day messages/es.json is real. That is a JUDGEMENT call, not a key count: a
// partly-filled catalog renders a Spanish/English mix, and this flag says "coherent enough to
// index". Everything flips together once it's set.
export const TRANSLATED_LOCALES: Locale[] = [baseLocale];

// Gated/noindex page routes that must never appear in /sitemap.xml. Two consumers assert it — the
// e2e reads the served document, `sitemap.xml/server.spec.ts` drives the handler against a mocked
// client — and they cannot share a file: the e2e imports `@playwright/test`, and the unit spec runs
// under node. A hand-copied second list is the rot DAR-99 measured, so the list lives HERE, beside
// the other flag the sitemap and the e2e already read from this module.
//
// Each entry is a PREFIX: '/admin' covers the whole staff area, and seo.e2e.ts's route enumeration
// filters the tree with the same semantics.
export const GATED_PATHS = [
	'/admin',
	'/account',
	'/login',
	'/signup',
	'/forgot-password',
	'/reset-password',
	// DAR-139's two emailed-link landing pages (/updates/confirm, /updates/unsubscribe). Not gated by
	// a sign-in — the unsubscribe deliberately needs no account — but they are noindex for the same
	// reason /reset-password is: a page whose only useful form of arrival carries a one-off token has
	// nothing to offer a crawler, and listing it would advertise a URL that is meaningless without one.
	'/updates'
];
