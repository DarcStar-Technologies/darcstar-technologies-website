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
// 2026-07-30: DAR-140 added the second route out of the updates ask — staff can now record a
// withdrawal for somebody who asks by reply or phone instead of using the emailed link — so
// `privacy_use_updates_body` names both. Same date as DAR-136 above rather than a bump, because both
// landed on the 30th; the constant not moving here is correct, not an oversight.
// 2026-07-30: DAR-191 rewrote `privacy_use_operational_body`'s middle. The page already promised that
// early-access mail "isn't a marketing list, and you can ask us to take you off it at any time" — a
// promise honored until now by an operator remembering — so what changed is that the request is
// recorded and enforced, and the copy now says the thing a reader could not previously tell: that
// being left alone does not require having your record deleted. Third change to land on the 30th, so
// the constant again does not move; check the clock at MERGE time, not at edit time.
// 2026-07-31: DAR-112 added the step-4A letter-of-intent question, so `privacy_collect_waitlist_body`
// enumerates it and now also promises what it ISN'T — answering creates no agreement or obligation.
// This one DOES move, and only because the DAR-136 entry above says to check: the work was done on the
// evening of the 30th local, which was already the 31st in UTC. Every other date in this file is a
// UTC one, so "today" as the author experiences it is the wrong clock to read.
export const PRIVACY_UPDATED = '2026-07-31';
export const TERMS_UPDATED = '2026-07-23';
