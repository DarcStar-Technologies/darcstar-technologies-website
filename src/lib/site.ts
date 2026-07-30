// Single source of truth for the brand's public identity — proper nouns and URLs, which are
// identical across locales, so deliberately NOT Paraglide messages (see contact-interests.ts
// for the slug/label split). Consumed by Footer / Seo / the About page (rendered as {expr}
// mustaches, so the no-raw-text ESLint rule is satisfied) and by the server lead-notifier.
// These are the settled public facts: trade name only, GitHub org + role-alias email.
export const SITE_NAME = 'DarcStar Technologies';
export const CONTACT_EMAIL = 'info@darcstar.tech';

/** The `From:` header for mail sent to a PERSON — the Resend-verified role alias, derived from the
 * two constants above rather than re-typed. Every user-facing mailer used to build this string for
 * itself.
 *
 * Deliberately NOT every From in the repo, and the line is not arbitrary: mail into our own info@
 * inbox (the contact lead, the waitlist lead, DAR-82's Priority-A alert) sets its own display name —
 * "DarcStar Contact", "DarcStar Waitlist" — so an inbox rule can sort it. Those are SORT KEYS chosen
 * per mailer, and two of them currently coincide by accident rather than by rule; sharing a constant
 * between them would couple values that merely happen to match, so a later change to one would
 * silently move the other. What this constant shares is the opposite: an address every recipient
 * must see identically, because it is the brand's identity rather than a label for us. */
export const EMAIL_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;
export const GITHUB_URL = 'https://github.com/DarcStar-Technologies';
export const GITHUB_HANDLE = 'DarcStar-Technologies';
