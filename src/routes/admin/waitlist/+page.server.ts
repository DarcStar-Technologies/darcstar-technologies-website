import { eq } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { getAuth } from '$lib/server/auth';
import { waitlistLead, waitlistSubmission } from '$lib/server/db/schema';
import { isRosterAdmin, isStaff } from '$lib/server/admin-access';
import { collateWaitlistLeads } from '$lib/server/waitlist-collate';
import {
	liftDoNotContact,
	readWaitlistTriageWindow,
	recordDoNotContact,
	unsubscribeUpdates
} from '$lib/server/waitlist-store';
import { mayContactLead } from '$lib/waitlist-outreach';
import { readWaitlistFunnelCounts, signupConversionRate } from '$lib/server/waitlist-funnel';
import {
	findAccountByEmail,
	findWaitlistInviteTarget,
	markWaitlistInvited,
	markWaitlistReviewed
} from '$lib/server/waitlist-invite';
import { linkSubmissionsToUser } from '$lib/server/contact-ownership';
import { mintActivationLink } from '$lib/server/activation';
import { sendActivationEmail } from '$lib/server/activation-email';
import { readEnv } from '$lib/server/env';
import { baseLocale } from '$lib/paraglide/runtime';
import {
	WAITLIST_LEAD_CLASSES,
	waitlistLeadClassRank,
	type WaitlistLeadClass
} from '$lib/waitlist-qualification';
import type { PageServerLoad } from './$types';

// Triage view of waitlist signups (sibling of /admin submissions). Reached only past the /admin route
// guard (../+layout.server.ts), so this inherits the isStaff gate. Cap the read — a triage list, not
// an archive; the UI notes when it's showing only the most recent slice.
//
// THE CAP IS ON LEADS, NOT SUBMISSIONS (DAR-88). One person is one line in this list however many
// times they submitted, which is the unit an operator triages; capping submissions instead would let a
// single repeat submitter push everyone else off the page. What the window is ORDERED by is last
// activity — see `lastActivityAt` below.
const WAITLIST_LIMIT = 200;

/** `?class=` → a real lead class, or null for "no filter" (absent, or anything unrecognized). */
const asLeadClass = (value: string | null): WaitlistLeadClass | null =>
	value !== null && (WAITLIST_LEAD_CLASSES as readonly string[]).includes(value)
		? (value as WaitlistLeadClass)
		: null;

export const load: PageServerLoad = async ({ url }) => {
	// getDb() reads platform.env via getRequestEvent(), so it must run before the first await.
	const db = getDb();
	// The funnel readout (DAR-66) — independent of the signup rows below, and issued first so the two
	// round-trips overlap rather than queue. It's an aggregate over an anonymous events table: no row
	// here can be tied to any signup in the list, by construction.
	//
	// FAIL-SOFT, and it's the same rule the write path follows: this page exists to show leads, and
	// analytics is the nice-to-have sitting on top of them. A failing aggregate must not take the
	// triage list down with it — which is not hypothetical, since a deploy that lands before its
	// migration has no `waitlist_funnel_event` table at all. Null (not zeros) so the view can say
	// "unavailable" rather than quietly report a funnel where nobody has ever done anything.
	const funnel = readWaitlistFunnelCounts(db).catch((err: unknown) => {
		console.error('waitlist funnel readout failed', err);
		return null;
	});

	// The windowed read (waitlist-store.ts). It lives there rather than inline because it carries a
	// hand-written correlated-subquery ordering rule — "most recently ACTIVE first", not lead creation —
	// and nothing in CI renders this page with data, so an inline fragment could only be validated in
	// production. As a store function it is pinned against a real libsql in waitlist-store.spec.ts.
	const { leads, submissions } = await readWaitlistTriageWindow(db, WAITLIST_LIMIT);

	// Grouping, per-submission and per-lead classification, and conflict detection all happen here
	// (waitlist-collate.ts) — read-time, nothing stored. The classification is COMPUTED ON READ for
	// DAR-65's reason, and it now has a second one: the inputs are spread across N immutable rows, so
	// a denormalized copy would need recomputing every time any of them arrived.
	const collated = collateWaitlistLeads(leads, submissions);

	// Counts over the WHOLE window, before filtering, so the chips keep showing the full picture
	// while a filter is applied.
	const counts = Object.fromEntries(
		WAITLIST_LEAD_CLASSES.map((leadClass) => [
			leadClass,
			collated.filter((lead) => lead.leadClass === leadClass).length
		])
	) as Record<WaitlistLeadClass, number>;

	const filter = asLeadClass(url.searchParams.get('class'));
	const visible = (
		filter === null ? [...collated] : collated.filter((lead) => lead.leadClass === filter)
	)
		// Priority first so an A lead can't be buried under 199 newer subscribers. Array.sort is
		// stable, so the SQL's most-recently-active-first ordering survives as the within-band tiebreak.
		.sort((a, b) => waitlistLeadClassRank(a.leadClass) - waitlistLeadClassRank(b.leadClass));

	const funnelCounts = await funnel;

	return {
		leads: visible,
		counts,
		filter,
		total: collated.length,
		// How many submissions the window covers — a lead count alone hides that one line can be five
		// people's worth of claims, which is precisely what an operator needs to notice.
		submissionTotal: submissions.length,
		reviewTotal: collated.filter((lead) => lead.needsReview).length,
		limit: WAITLIST_LIMIT,
		funnel: funnelCounts,
		// The primary metric, resolved server-side beside the counts it comes from so the view can't
		// compute a different one. Null when nothing has been viewed yet — a rate needs a denominator —
		// and equally null when the readout itself is unavailable.
		conversion: funnelCounts === null ? null : signupConversionRate(funnelCounts)
	};
};

export const actions: Actions = {
	// Delete a whole lead — staff (admin + operator). SvelteKit does NOT run the layout guard before a
	// form action (only on the re-render), so authorize here; readEnv + getDb read request-scoped env,
	// so call them before the first await. Idempotent: a missing/already-deleted id is a no-op.
	//
	// Takes the SUBMISSIONS with it, via the schema's `on delete cascade`. That's the right unit for
	// "remove this person from the list": leaving their submissions behind would orphan rows nothing
	// can reach, and re-signing-up would then produce a lead with a confusing history.
	delete: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { error: 'forbidden' as const });
		}
		const db = getDb();
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing' as const });
		await db.delete(waitlistLead).where(eq(waitlistLead.id, id));
		return { ok: true as const };
	},

	// Delete ONE submission, keeping the lead and its other submissions (DAR-88). This is the operator's
	// answer to the cost append-only accepts: anyone can add a submission under a known address, so
	// there has to be a way to drop a junk one without discarding the person. Deliberately separate
	// from `delete` above — one removes a claim, the other removes a prospect, and a single button
	// doing both by context would eventually delete the wrong thing.
	deleteSubmission: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { error: 'forbidden' as const });
		}
		const db = getDb();
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing' as const });
		await db.delete(waitlistSubmission).where(eq(waitlistSubmission.id, id));
		return { ok: true as const };
	},

	// Record that this address has withdrawn from product-and-research updates (DAR-140) — the operator
	// half of the login-free unsubscribe DAR-139 built.
	//
	// /privacy promises we will act on a request that reaches us by email, and until this existed the
	// only vocabulary here was DELETE: honoring "please take me off that" meant destroying answers
	// nobody asked us to destroy. It writes exactly what the emailed link writes, deliberately, so a
	// request honored by hand and one honored by the recipient land the SAME lead in the SAME state —
	// the durable one that `claimUpdatesConfirmSend` refuses forever after.
	//
	// NOT "clear consent_updates on their submissions", which the ticket originally proposed and which
	// is wrong three times over: the ask is triggered by the consent flag on the INCOMING submission
	// (waitlist.remote.ts), so clearing stored ones stops no future email at all; the resulting state is
	// indistinguishable from never having ticked the box, so the next submission would ask again — a
	// manual path weaker than the self-service one it mirrors; and it would edit an append-only row,
	// where a fabricated submission already has the right tool in `deleteSubmission` above.
	//
	// The actor is passed through to `updates_unsubscribed_by`, which is what keeps "the mailbox itself
	// said so" (null) distinguishable from "we recorded this on their behalf" — different strengths of
	// evidence, and a distinction that stopped being inferable from the timestamp the moment this action
	// existed.
	recordOptOut: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { optOut: { error: 'forbidden' as const } });
		}
		const db = getDb();
		const actorId = locals.user!.id;
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { optOut: { error: 'missing' as const } });

		// Unlike `delete` above, a missing lead is reported rather than treated as a no-op: this write is
		// irreversible from here, so an operator who pressed the button has to learn that the row went
		// away between render and click instead of being told it worked.
		const row = await unsubscribeUpdates(db, id, actorId);
		if (!row) return fail(404, { optOut: { error: 'not_found' as const } });

		// The durable who-recorded-what history, same posture as the invite line below: the column holds
		// the FIRST recorder and a later press cannot overwrite it, so this log is where a repeat press —
		// or a press against a lead that had already unsubscribed itself — is visible at all.
		console.info(
			'[updates] optout.recorded',
			JSON.stringify({ leadId: id, email: row.email, recordedBy: actorId })
		);

		return { optOut: { ok: true as const, email: row.email } };
	},

	// Record "don't contact me" (DAR-191) — the outreach axis, sibling of `recordOptOut` above and
	// deliberately NOT the same button. They are different requests: one stops a mailing list the
	// mailbox itself joined, the other stops US reaching out. Someone who asked for both gets both
	// recorded, which is why the page says so under the table.
	//
	// This is where DAR-140's original question landed: it asked whether an updates opt-out should also
	// clear `contact_permission`, and the answer was no, because clearing an answer on an append-only
	// submission stops nothing (no code sends from it), leaves a state indistinguishable from never
	// having been asked, and edits a row the whole model treats as immutable. So the request gets a
	// column of its own rather than an edit to somebody's answer.
	recordDoNotContact: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { doNotContact: { error: 'forbidden' as const } });
		}
		const db = getDb();
		const actorId = locals.user!.id;
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { doNotContact: { error: 'missing' as const } });

		// Reported rather than swallowed, like `recordOptOut` and unlike `delete`: an operator who
		// pressed this has to learn the row went away between render and click.
		const row = await recordDoNotContact(db, id, actorId);
		if (!row) return fail(404, { doNotContact: { error: 'not_found' as const } });

		// The durable history — `do_not_contact_by` holds the FIRST recorder and is cleared outright by a
		// lift, so a repeat press, and the record of anything that was there before, live here or nowhere.
		console.info(
			'[outreach] donotcontact.recorded',
			JSON.stringify({ leadId: id, email: row.email, recordedBy: actorId })
		);

		return { doNotContact: { ok: true as const, email: row.email } };
	},

	// Lift a recorded do-not-contact — ADMIN ONLY, and the asymmetry with the action above is the whole
	// point rather than a permissions detail. Recording somebody's request is ordinary staff work;
	// un-recording it is not, and a control an operator can press sits one click from the Invite button
	// it suppresses, which would turn a durable request into a speed bump. What it buys back is that a
	// mis-press on the wrong row, and a prospect who later says "actually, let's talk", stay recoverable
	// without deleting their submissions.
	//
	// `isRosterAdmin` IS THE BOUNDARY HERE, which is new. Everywhere else in the repo it is a UX gate
	// with a Better Auth endpoint re-checking behind it — its own docstring says so, and /admin's layout
	// repeats it. A form action has nothing behind it: SvelteKit runs the layout guard only on the
	// re-render, so this line is the entire authorization check, exactly as `isStaff` is for its
	// siblings. That is why it has a test of its own.
	liftDoNotContact: async ({ request, locals }) => {
		if (!isRosterAdmin(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { doNotContact: { error: 'forbidden' as const } });
		}
		const db = getDb();
		const actorId = locals.user!.id;
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { doNotContact: { error: 'missing' as const } });

		const row = await liftDoNotContact(db, id);
		if (!row) return fail(404, { doNotContact: { error: 'not_found' as const } });

		// THE ONLY RECORD THAT SURVIVES. The lift clears both columns, so without this line there would
		// be no trace that a request was ever recorded or by whom it was undone.
		console.info(
			'[outreach] donotcontact.lifted',
			JSON.stringify({ leadId: id, email: row.email, liftedBy: actorId })
		);

		return { doNotContact: { ok: true as const, email: row.email, lifted: true as const } };
	},

	// Mark a lead's submissions as reconciled by a human (DAR-88). A STAMP, not a merge — nothing is
	// copied from a submission onto the lead, because a canonical-answers column set is the overwrite
	// problem rebuilt with a friendlier interface. What it records is that someone looked; the outcome
	// lives wherever they took it (an outreach, the CRM). A later submission re-opens the lead on its
	// own, since `needsReview` compares the newest submission against this timestamp.
	review: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { error: 'forbidden' as const });
		}
		const db = getDb();
		const actorId = locals.user!.id;
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing' as const });
		await markWaitlistReviewed(db, id, actorId);
		return { ok: true as const };
	},

	// Invite a prospect to create an account (DAR-67). Public sign-up is closed, so this is one of the
	// only two ways an account comes into existence (the other is the /admin/users roster).
	//
	// Addresses a LEAD since DAR-88 — an invitation goes to a person, not to one of their submissions.
	//
	// THE ORDER OF OPERATIONS IS THE DESIGN. The email is sent BEFORE `invited_at` is stamped, so the
	// column means "a message was accepted by Resend", never "we tried". A send failure therefore
	// leaves the row looking un-invited and the button still saying Invite — which is exactly right,
	// because the operator's next move is to try again. Retrying is safe: the account created on the
	// failed attempt is found rather than duplicated, and a fresh activation link is minted.
	//
	// Unlike every other outbound mail in this codebase, the send is AWAITED and its failure surfaces.
	// Fire-and-forget is right for a visitor's own submission — dropping their lead over a mail blip
	// would be worse — but here the operator is the only person who can retry, and telling them
	// "invited" when nothing arrived would strand the prospect indefinitely.
	invite: async ({ request, locals }) => {
		// Form actions skip the layout guard, so authorize here. Staff — admin OR operator — matching
		// the rest of /admin: the account this mints is always the least-privileged `user` role, so
		// there is no escalation an operator could reach through it.
		const adminIds = readEnv('ADMIN_USER_IDS');
		if (!isStaff(locals.user, adminIds))
			return fail(403, { invite: { error: 'forbidden' as const } });
		// Every request-scoped handle resolved before the first await (env reads back empty once the
		// request's async context is left).
		const auth = getAuth();
		const db = getDb();
		const resendKey = readEnv('RESEND_API_KEY');
		const actorId = locals.user!.id;

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { invite: { error: 'missing' as const } });

		// The address is the LEAD's (the one field no submission can change); the name comes from the
		// EARLIEST submission that gave one, so a stranger adding a later submission can't choose how we
		// greet the real person. See findWaitlistInviteTarget.
		const row = await findWaitlistInviteTarget(db, id);
		// Deleted from under the operator between render and click.
		if (!row) return fail(404, { invite: { error: 'not_found' as const } });

		// "Don't contact me" (DAR-191). CHECKED HERE, before `findAccountByEmail` and before anything is
		// created or minted, so a refused invite leaves no account, no activation token and no mail —
		// the position matters as much as the check, which is why the test asserts the lookup below was
		// never reached. The button is hidden for a flagged lead, but hiding it is cosmetic: a form
		// action is a public POST endpoint and this line is the actual control.
		if (!mayContactLead(row)) return fail(400, { invite: { error: 'do_not_contact' as const } });

		const existing = await findAccountByEmail(db, row.email, adminIds);

		// Refuse to mail a set-password link to a colleague. The link is a password-reset token, so an
		// operator could otherwise use the invite button to fire a credential-reset mail at an admin's
		// inbox just by adding that address to the waitlist. It is not a takeover (the mail goes to the
		// account's own address, which the operator does not control), but it is an unnecessary primitive
		// and a confusing email; staff accounts are managed on /admin/users.
		if (existing?.isStaff) return fail(400, { invite: { error: 'staff_account' as const } });

		// Equally, refuse a roster-DISABLED account. Setting a password does not lift a ban, so the
		// invitation would work perfectly right up to the point where it doesn't: the prospect follows a
		// live link, chooses a password, and then can't sign in — and neither they nor the operator who
		// pressed the button would have any way to see why. Re-enable it on /admin/users first.
		if (existing?.banned) return fail(400, { invite: { error: 'account_disabled' as const } });

		let userId = existing?.id;
		const created = userId === undefined;
		if (userId === undefined) {
			try {
				const res = await auth.api.createUser({
					// NO PASSWORD. better-auth treats it as optional and simply omits the credential account
					// (admin/routes.mjs), and POST /reset-password creates that account when the invitee sets
					// their own. So there is never a server-generated password sitting in the database that
					// nobody chose and nobody can be told about — the account is genuinely unusable until the
					// person holding the mailbox acts. The roster's create action still sets one, because an
					// admin creating staff hands the password over directly.
					//
					// Headers are deliberately NOT forwarded. With a request attached the endpoint demands an
					// ADMIN session (`hasPermission` with `adminRoles: ['admin']`), which would 403 the
					// operators this page admits; without one it is a trusted server-side call, and the
					// `isStaff` gate above is then the authorization. Safe because the role is pinned to `user`
					// here — an operator cannot mint staff through this path.
					body: {
						email: row.email,
						name: row.name ?? row.email,
						role: 'user',
						// Staff vouch for the address by choosing this row, exactly as the roster create does.
						// Without it `requireEmailVerification` would 403 the invitee at their first sign-in
						// with no way out, since nothing in this flow sends a verification link.
						data: { emailVerified: true }
					}
				});
				userId = res.user.id;
			} catch (err) {
				console.error('[invite] creating the account failed', err);
				return fail(500, { invite: { error: 'create_failed' as const } });
			}
		}

		// Claim their earlier anonymous contact submissions, same vouch as the roster path (#96) — so the
		// messages they sent before having an account are waiting at /account when they arrive.
		//
		// Runs for a FOUND account too, not just a freshly created one, and that isn't belt-and-braces:
		// an account predating DAR-67 may be an unverified self-registrant whose `afterEmailVerification`
		// backfill never fired, so being invited is the first moment anyone vouches for them. The helper
		// only touches rows with `user_id IS NULL`, so re-running it is a no-op rather than a re-assignment.
		// Best-effort: a link failure must not fail an invitation that is otherwise fine.
		try {
			await linkSubmissionsToUser(db, userId, row.email);
		} catch (err) {
			console.error('[invite] linking submissions to the invited account failed', err);
		}

		// Wrapped like every other step: the account may already exist by now, and an unhandled throw
		// here would replace the triage page with SvelteKit's error screen instead of a message the
		// operator can act on.
		let link;
		try {
			link = await mintActivationLink(auth, userId);
		} catch (err) {
			console.error('[invite] minting the activation link failed', err);
			return fail(500, { invite: { error: 'create_failed' as const } });
		}

		if (!resendKey) {
			// No Resend key — local dev. Log the link so a developer can click it, and report the failure
			// rather than claiming success: `invited_at` stays null, so nothing in the UI will pretend an
			// email went out. (Never reached in prod, where the key is always set, so the token URL is not
			// logged there.)
			console.warn(`[invite] activation email skipped (no RESEND_API_KEY) — link: ${link.url}`);
			return fail(500, { invite: { error: 'email_unconfigured' as const } });
		}
		try {
			await sendActivationEmail(
				resendKey,
				{ to: row.email, name: row.name ?? row.email, url: link.url },
				baseLocale
			);
		} catch (err) {
			console.error('[invite] sending the activation email failed', err);
			return fail(502, { invite: { error: 'email_failed' as const } });
		}

		await markWaitlistInvited(db, id, actorId);

		// One structured line per invite, mirroring the login-audit posture (auth-audit.ts): Workers Logs
		// captures console.* and timestamps it, so no `ts` field. This is the only record of WHO invited
		// WHOM over time — `invited_at` is overwritten by a resend, so history lives here or nowhere.
		console.info(
			'[invite] activation.sent',
			JSON.stringify({ leadId: id, email: row.email, userId, invitedBy: actorId, created })
		);

		return { invite: { ok: true as const, email: row.email, created } };
	}
};
