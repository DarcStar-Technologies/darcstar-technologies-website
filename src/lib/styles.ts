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

// The typographic treatment shared by EVERY field label, with no layout in it. Split out one level
// further than DAR-218 left it (DAR-219): that refactor composed the flex row so the `<legend>`
// subset could share it, and the subset it did not know about was larger than the one it fixed —
// 17 sites across 7 files wearing this ink as a plain `block`, in files that imported `fieldClass`
// and hand-typed the label beside it. A superset scan cannot see either, so the ink is the seam.
const fieldLabelInk = 'text-xs font-medium tracking-wide text-body';

// The row form, without the spacing that separates it from its control. A <legend> carries that
// margin on the legend rather than on the row inside it (below), so the two differ by exactly
// `mb-1.5`.
const fieldLabelRow = `flex items-baseline gap-2 ${fieldLabelInk}`;

/** A field's label row — the label text plus an optional muted badge ("optional") beside it.
 *
 * Use this when the label CAN carry a badge; `fieldLabelBlockClass` when it can't. The flex row
 * exists for the badge, so a label with no badge shouldn't pay for it — every one of this class's
 * call sites renders a `{#if}` badge, and every one of the block variant's renders bare text. */
export const fieldLabelClass = `mb-1.5 ${fieldLabelRow}`;

/** The same label, with no badge beside it — a plain block above its control.
 *
 * The majority form by a wide margin (17 sites to 6). Kept distinct rather than folded into
 * `fieldLabelClass` because `flex` on a lone text node is not a no-op: it makes that text an
 * anonymous flex item, which changes how whitespace between it and any sibling markup collapses.
 * Two named variants of one ink is honest; one variant that quietly re-boxes 17 labels is not. */
export const fieldLabelBlockClass = `mb-1.5 block ${fieldLabelInk}`;

/** The same row inside a `<fieldset>`'s `<legend>`, where the spacing belongs to the legend: a
 * `<legend>` is laid out by the UA rather than in normal flow, so a bottom margin on the row inside
 * it is unreliable across browsers. Same treatment, one level of nesting further in. */
export const fieldLegendRowClass = fieldLabelRow;

/** The muted badge that sits inside a label row beside the label text ("optional").
 *
 * Exported because `fieldLabelClass` above has always DESCRIBED this badge as part of the pattern
 * while exporting only the row — so the badge was hand-typed at all seven sites that render one
 * (DAR-218), under four different prop names. A label row is a two-part idiom; shipping one part is
 * what let the other drift. `font-normal` is load-bearing: it cancels the row's `font-medium`, so
 * the badge reads as secondary to the label it annotates rather than as a second label. */
export const fieldBadgeClass = 'font-normal text-faint';

/** The supporting line under a label: the survey question a short label can't carry. Wired as
 * `aria-describedby`, so it's a description rather than part of the control's accessible name. */
export const fieldHelpClass = 'mb-1.5 text-xs leading-relaxed text-faint';

/** A checkbox drawn into a label row — the consent tick, the pilot-contact permission, and every
 * option in a `GlassCheckboxGroup`.
 *
 * Native rather than a custom control on purpose (it works with no JS and keeps the platform's own
 * focus/checked semantics), so `accent-*` is the only colour lever the UA gives us and the sizing
 * has to be stated. `mt-0.5` optically centres a `size-4` box against the first line of a label
 * that may wrap; `shrink-0` keeps it square when that label wraps in a flex row. */
export const checkboxClass = 'mt-0.5 size-4 shrink-0 accent-primary-500';
