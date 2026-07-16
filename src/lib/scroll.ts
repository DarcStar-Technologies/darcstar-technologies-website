import { prefersReducedMotion } from 'svelte/motion';

/**
 * Scroll behaviour that respects the user's reduced-motion preference: smooth
 * when motion is allowed, instant otherwise. Shared by the header's in-page
 * anchor scroll (`scrollIntoView`) and the back-to-top control (`scrollTo`).
 */
export const scrollBehavior = (): ScrollBehavior =>
	prefersReducedMotion.current ? 'auto' : 'smooth';
