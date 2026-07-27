// Waitlist resume vocabulary (DAR-75) — the two names the PAGE needs, split out of the server module
// for exactly the reason DAR-66's event slugs and DAR-65's lead classes are: a `.svelte` file cannot
// import from `$lib/server`, and the page renders the restart link. Everything with teeth — the cookie
// name, the signing domain, mint/verify, the cookie writes — stays in `$lib/server/waitlist-resume.ts`,
// where SvelteKit's import guard makes "the client can't reach it" structural.

/**
 * The stages a visitor can be resumed INTO — every screen the flow can leave someone on.
 *
 * `step1` is deliberately absent: it is the ABSENCE of resume state, not a state to store. The list
 * is `WaitlistNextStep` (what a step endpoint routes to) plus `step2`, which only step 1 routes to;
 * a type-level guard in the server module fails the build if those two drift apart, since this file
 * can't import the server type to say so directly.
 */
export const WAITLIST_RESUME_STAGES = ['step2', 'step3', 'step4a', 'step4b', 'done'] as const;
export type WaitlistResumeStage = (typeof WAITLIST_RESUME_STAGES)[number];

/**
 * The query parameter that throws the resume state away: `/waitlist?restart`.
 *
 * WHY IT EXISTS. Resuming a FINISHED flow means a visitor who completed the waitlist and came back to
 * sign up a second address (a colleague, a work account) would be shown the confirmation with no form
 * and no way out — a worse dead end than the blank form this feature replaces. The load drops the
 * cookie when it sees this, and the page offers it as a link on any resumed render.
 */
export const WAITLIST_RESTART_PARAM = 'restart';
