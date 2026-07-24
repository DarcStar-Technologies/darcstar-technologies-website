// Relative (not $lib) import: seo.e2e.ts imports this module under Playwright's transform,
// which resolves relative paths unconditionally — same reason security-headers.ts is alias-free.
import { baseLocale, type Locale } from './paraglide/runtime';

// Locales whose copy is genuinely translated. `es` is wired but still English placeholder
// (issue #18), so it is NOT listed. This ONE flag drives every "is this locale real?" decision:
// Seo.svelte's noindex + og:locale:alternate loop (and, later, its hreflang set), and the
// /sitemap.xml URL set (untranslated locale trees stay out of the sitemap — they're noindex).
// Add 'es' here the day messages/es.json is real, and everything flips together.
export const TRANSLATED_LOCALES: Locale[] = [baseLocale];
