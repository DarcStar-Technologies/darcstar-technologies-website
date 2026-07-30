// Single source of truth for the brand's public identity — proper nouns and URLs, which are
// identical across locales, so deliberately NOT Paraglide messages (see contact-interests.ts
// for the slug/label split). Consumed by Footer / Seo / the About page (rendered as {expr}
// mustaches, so the no-raw-text ESLint rule is satisfied) and by the server lead-notifier.
// These are the settled public facts: trade name only, GitHub org + role-alias email.
export const SITE_NAME = 'DarcStar Technologies';
export const CONTACT_EMAIL = 'info@darcstar.tech';

/** The `From:` header every user-facing email ships with — the Resend-verified role alias, derived
 * from the two constants above rather than re-typed. Six mailers had built this same string
 * independently. NOT the only From in the repo: the two internal LEAD emails deliberately send as
 * "DarcStar Contact" / "DarcStar Waitlist" so an inbox rule can tell them apart from user-facing
 * mail, which is why this is a shared default and not a rule about every message. */
export const EMAIL_FROM = `${SITE_NAME} <${CONTACT_EMAIL}>`;
export const GITHUB_URL = 'https://github.com/DarcStar-Technologies';
export const GITHUB_HANDLE = 'DarcStar-Technologies';
