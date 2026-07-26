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
