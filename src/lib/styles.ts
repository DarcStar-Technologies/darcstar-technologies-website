// Shared cross-route link treatments. These live in a plain module (not a component's
// <script module>) so a page that only needs the class string doesn't import a component —
// route chunks stay decoupled from unrelated component code.

/** The site's one inline-link treatment (the login/signup cross-link style): primary-colored,
 * underline on hover. Content links (research card titles, in-copy CTAs) share it so the
 * affordance can't drift. `hover-focus:` (DAR-57) so a keyboard reaching the link sees the same
 * state change a pointer does — on top of the site-wide focus ring, which is the separate
 * guarantee that focus is VISIBLE (both in layout.css). */
export const inlineLinkClass =
	'font-medium text-primary-500 underline-offset-4 transition-colors hover-focus:text-primary-400 hover-focus:underline';

/** The quiet utility-link treatment (clear-filters, "how we verify" — actions that support the
 * content rather than being it): muted until hover or keyboard focus. */
export const mutedLinkClass = 'text-xs text-muted transition-colors hover-focus:text-white';

// --- Form chrome -----------------------------------------------------------------------------
// Every form in the site (contact, waitlist steps, login/signup/reset, admin, the /research
// filter selects) wears these. They live here rather than in a component's <script module> for the
// reason at the top of this file: a route that needs nothing but the class string shouldn't have to
// import a form component to get it. GlassSelect and GlassCheckboxGroup use them too, so a control
// that renders its own label can't drift from one that delegates.

/** The recessed glass-well treatment for text inputs, textareas and native selects. */
export const fieldClass = 'glass-field w-full rounded-lg px-3.5 py-2.5 text-sm';

/** The full-width pill submit button. */
export const submitButtonClass =
	'glass-btn w-full rounded-full px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60';

/** A field's label row — the label text plus an optional muted badge ("optional") beside it. */
export const fieldLabelClass =
	'mb-1.5 flex items-baseline gap-2 text-xs font-medium tracking-wide text-body';

/** The supporting line under a label: the survey question a short label can't carry. Wired as
 * `aria-describedby`, so it's a description rather than part of the control's accessible name. */
export const fieldHelpClass = 'mb-1.5 text-xs leading-relaxed text-faint';
