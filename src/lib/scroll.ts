import { prefersReducedMotion } from 'svelte/motion';

/**
 * Scroll behaviour that respects the user's reduced-motion preference: smooth when motion
 * is allowed, instant otherwise. Used by the back-to-top control (`scrollTo`); kept as the
 * shared reduced-motion scroll policy for any programmatic scroll we add.
 */
export const scrollBehavior = (): ScrollBehavior =>
	prefersReducedMotion.current ? 'auto' : 'smooth';
