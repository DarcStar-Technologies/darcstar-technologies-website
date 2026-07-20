import { createAuthClient } from 'better-auth/svelte';

// Browser-side Better Auth client (#69), used ONLY by the admin login. Signing in through the
// client POSTs to /api/auth/sign-in/email, which SvelteKit routes through `svelteKitHandler` →
// Better Auth's router → the DB-backed rate limiter (auth-options.ts). A direct server-side
// `auth.api.signInEmail` call would bypass the router and therefore the limiter, leaving the
// only sign-in path unthrottled — so sign-in deliberately goes over HTTP, not a form action.
//
// baseURL is left to default to the current origin: sign-in is always same-origin, which is what
// Better Auth's origin/CSRF check expects (production origin + the workers.dev previews are
// trusted in auth.ts). Methods are only ever called from browser event handlers.
export const authClient = createAuthClient();
