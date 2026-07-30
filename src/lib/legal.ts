// Last-revision dates for the legal pages (ISO). Rendered locale-aware through the shared
// `legal_updated` message's {date} param (formatDate + getLocale), so the en/es copies of a
// page can never show different dates and translators never touch a date. Bump the matching
// constant whenever that page's copy changes substantively (docs/legal.md).
// 2026-07-30: DAR-136 added Twenty to the processor list (the contact form now produces a CRM
// signal), rewrote the Turso entry and re-scoped the intro to "service providers". That shipped
// while this constant read the 29th — checked when the date genuinely was the 29th, and the merge
// crossed midnight UTC — so the page announced a new processor under an unchanged date. Read the
// clock at MERGE time, not at edit time; a stale date here is the one thing on the page that
// silently tells a returning reader nothing has changed.
export const PRIVACY_UPDATED = '2026-07-30';
export const TERMS_UPDATED = '2026-07-23';
