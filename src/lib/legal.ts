// Last-revision dates for the legal pages (ISO). Rendered locale-aware through the shared
// `legal_updated` message's {date} param (formatDate + getLocale), so the en/es copies of a
// page can never show different dates and translators never touch a date. Bump the matching
// constant whenever that page's copy changes substantively (docs/legal.md).
export const PRIVACY_UPDATED = '2026-07-23';
export const TERMS_UPDATED = '2026-07-23';
