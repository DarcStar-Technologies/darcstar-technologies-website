// Single source for the security-header values shared across delivery surfaces (DAR-45): the CSP
// allowlist origins (vite.config.ts imports these at config time), the handleSecurityHeaders hook,
// and the signup page's Turnstile loader. The plaintext root `_headers` file (assets layer) can't
// import TS — it restates HSTS_VALUE and is the one copy still synced by hand. Keep these as plain
// `const` string literals: the kit `csp` config needs their literal types (HostSource), not
// `string`. See docs/security-headers.md.
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;
export const SANITY_IMAGE_CDN_ORIGIN = 'https://cdn.sanity.io';
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
