// What the two updates landing pages do when somebody presses the button (DAR-139).
//
// One module for both, because the part they share is the part that matters: EVERY way of failing
// resolves to the same generic answer. A bad token, an expired one, one signed for the other page, a
// deploy with no signing secret, and a lead that has since been deleted are all `invalid` — the
// continuation token's rule (waitlist-token.ts), and it is what keeps a page reached from an email
// from becoming a "does this address exist?" oracle for anyone who can guess a URL.
//
// The one failure that is NOT folded in is a database error, and that distinction is deliberate. The
// visitor is being told what we have recorded about them; "we couldn't reach the database" and "that
// link is not valid" are different facts, and telling somebody their unsubscribe worked when it threw
// would be the worst answer this page can give. Analytics may fail silently (DAR-66); a withdrawal may
// not.
import type { Db } from './db';
import type { WaitlistSigningSecret } from './waitlist-secret';
import { waitlistUpdatesState, type WaitlistUpdatesSignals } from '$lib/waitlist-updates';

/**
 * What a landing page renders. The four lead states plus the two failures — so a page branches on one
 * value and there is no state a caller can invent that the store did not report.
 */
export type UpdatesActionResult = ReturnType<typeof waitlistUpdatesState> | 'invalid' | 'error';

/** Request-scoped handles, resolved by the caller BEFORE its first await (workerd's `platform.env`). */
export interface UpdatesActionEnv {
	db: Db;
	secret: WaitlistSigningSecret | undefined;
	/**
	 * The HTTP method of the request asking for this. Anything but `POST` is refused, and that guard is
	 * the whole double-opt-in property expressed as code rather than as a convention about where the
	 * call sits.
	 *
	 * Mail scanners and link previewers fetch every URL in an inbound message, so a confirmation
	 * reachable from a GET is confirmed by a machine on delivery — a gate that verifies nothing while
	 * looking like one. The obvious way to enforce that is "only call this from an action", which no
	 * type can check and which a future `load` would break silently. Passing the method makes the
	 * accidental case impossible: a load runs with the visitor's GET and gets `invalid` back.
	 *
	 * A caller could of course hardcode `'POST'`. That is true of any guard, and it is not the failure
	 * mode this exists for — it turns a silent mistake into a deliberate one.
	 */
	method: string;
}

/**
 * Verify one of the two emailed links and apply its write, reporting the address's state afterwards.
 *
 * `verify` and `write` are passed in rather than branched on a mode flag: the confirm and unsubscribe
 * pages differ in exactly those two functions, and a flag would put the decision about WHICH
 * capability a token is inside a function that neither page can see. The signature also stops a page
 * mixing them — you cannot hand this an unsubscribe verifier and a confirm write without saying so out
 * loud at the call site.
 *
 * Returns the post-write state, so the page says what is true rather than what it assumed the write
 * would do: confirming an address that has already withdrawn reports `unsubscribed`, because that is
 * what the store refused to change (see `confirmUpdates`).
 */
export async function runUpdatesAction(
	env: UpdatesActionEnv,
	token: unknown,
	verify: (secret: WaitlistSigningSecret, token: unknown) => Promise<string | null>,
	write: (db: Db, leadId: string) => Promise<WaitlistUpdatesSignals | null>
): Promise<UpdatesActionResult> {
	// Nothing mutates on a GET — see `method`. Checked before anything else, so a misplaced call costs
	// no verification and no query.
	if (env.method !== 'POST') return 'invalid';

	// No secret means no deploy-wide way to verify anything, so nothing here can be trusted — the same
	// "this feature is off" posture the rest of the flow takes, and `invalid` is the honest thing to
	// show for a link we cannot read.
	if (!env.secret) return 'invalid';

	const leadId = await verify(env.secret, token);
	if (leadId === null) return 'invalid';

	try {
		const after = await write(env.db, leadId);
		// A verified token whose lead is gone. Folded into `invalid` on purpose: it is the one branch
		// that would otherwise let a holder tell "this address was deleted" from "this link is stale".
		return after === null ? 'invalid' : waitlistUpdatesState(after);
	} catch (err) {
		// Logged without the lead id or the address — the rule the sends follow, and it applies here for
		// the same reason: these logs are read far away from the person they are about.
		console.error('waitlist updates action failed', err);
		return 'error';
	}
}
