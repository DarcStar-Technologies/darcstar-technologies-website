import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Invite-only notice (DAR-67). This route used to be the public sign-up form (#96 PR 2); accounts are
// now created only by staff, from /admin/waitlist, so there is nothing here to submit — no actions, no
// Turnstile widget, no `resend` affordance (that one lives on in LoginForm, where a legacy unverified
// account still needs it).
//
// THE ROUTE IS KEPT ON PURPOSE. Deleting it would 404 every bookmark, emailed link and search result
// pointing at /signup, which is precisely the audience that most needs to be told the door moved
// rather than that it vanished. It is already `noindex` and absent from the sitemap, so keeping it
// costs no discovery surface.
//
// It is also NOT the gate. Anyone can POST straight to /api/auth/sign-up/email; that request is
// rejected by better-auth because `emailAndPassword.disableSignUp` is set (auth-options.ts). This page
// only explains the situation to a human.
export const load: PageServerLoad = ({ locals }) => {
	// A signed-in visitor has an account already — send them to their portal (/account admits staff too).
	if (locals.user) redirect(303, '/account');
	return {};
};
