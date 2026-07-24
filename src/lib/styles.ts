// Shared cross-route link treatments. These live in a plain module (not a component's
// <script module>) so a page that only needs the class string doesn't import a component —
// route chunks stay decoupled from unrelated component code.

/** The site's one inline-link treatment (the login/signup cross-link style): primary-colored,
 * underline on hover. Content links (research card titles, in-copy CTAs) share it so the
 * affordance can't drift. */
export const inlineLinkClass =
	'font-medium text-primary-500 underline-offset-4 transition-colors hover:text-primary-400 hover:underline';

/** The quiet utility-link treatment (clear-filters, "how we verify" — actions that support the
 * content rather than being it): muted until hover. */
export const mutedLinkClass = 'text-xs text-muted transition-colors hover:text-white';
