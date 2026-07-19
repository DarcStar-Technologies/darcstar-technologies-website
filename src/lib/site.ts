// Single source of truth for the brand's public identity — proper nouns and URLs, which are
// identical across locales, so deliberately NOT Paraglide messages (see contact-interests.ts
// for the slug/label split). Consumed by Footer / Seo / the About page (rendered as {expr}
// mustaches, so the no-raw-text ESLint rule is satisfied) and by the server lead-notifier.
// These are the settled public facts: trade name only, GitHub org + role-alias email.
export const SITE_NAME = 'DarcStar Technologies';
export const CONTACT_EMAIL = 'info@darcstar.tech';
export const GITHUB_URL = 'https://github.com/DarcStar-Technologies';
export const GITHUB_HANDLE = 'DarcStar-Technologies';
