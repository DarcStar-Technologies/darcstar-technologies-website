// One-time "email verified — welcome" affordance (#106). When a freshly-verified user is auto-signed
// in, Better Auth's /verify-email redirects them to `callbackURL`; the sign-up + resend actions pass
// `ACCOUNT_WELCOME_CALLBACK` so they land on /account carrying a query flag, and the page raises a
// one-time welcome banner. Centralised here so the callbackURL the actions SEND and the flag the page
// READS can't drift apart — `account-welcome.spec.ts` pins that round-trip. Better Auth accepts a
// relative callbackURL with a query string (its matchesOriginPattern relative-path branch has an
// explicit `(?:\?…)?` group), so this rides the verify redirect intact — keep the value relative.

/** Query flag the verify-email callback carries; /account shows the welcome banner when it's set. */
export const WELCOME_FLAG = 'welcome';

/** callbackURL passed to Better Auth's sign-up / send-verification-email so the verified user lands here. */
export const ACCOUNT_WELCOME_CALLBACK = `/account?${WELCOME_FLAG}=1`;

/** True when a URL carries the freshly-verified welcome flag (matching the value the callback sets). */
export function isWelcome(url: URL): boolean {
	return url.searchParams.get(WELCOME_FLAG) === '1';
}
