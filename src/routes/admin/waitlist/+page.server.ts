import { desc, eq, inArray } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { getAuth } from '$lib/server/auth';
import { waitlistLead, waitlistSubmission } from '$lib/server/db/schema';
import { isStaff } from '$lib/server/admin-access';
import { collateWaitlistLeads } from '$lib/server/waitlist-collate';
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
// single repeat submitter push everyone else off the page.
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

	// Two queries rather than a join: a join would repeat every lead column once per submission and
	// then need re-grouping in memory anyway, and the second query is skipped entirely on an empty
	// list. Ordering the leads here (and not after collation) is what the cap applies to.
	const leads = await db
		.select({
			id: waitlistLead.id,
			email: waitlistLead.email,
			invitedAt: waitlistLead.invitedAt,
			invitedBy: waitlistLead.invitedBy,
			activatedAt: waitlistLead.activatedAt,
			reviewedAt: waitlistLead.reviewedAt,
			reviewedBy: waitlistLead.reviewedBy,
			createdAt: waitlistLead.createdAt
		})
		.from(waitlistLead)
		.orderBy(desc(waitlistLead.createdAt))
		.limit(WAITLIST_LIMIT);

	const submissions = leads.length
		? await db
				.select({
					id: waitlistSubmission.id,
					leadId: waitlistSubmission.leadId,
					email: waitlistSubmission.email,
					name: waitlistSubmission.name,
					company: waitlistSubmission.company,
					role: waitlistSubmission.role,
					companySize: waitlistSubmission.companySize,
					interest: waitlistSubmission.interest,
					hearAbout: waitlistSubmission.hearAbout,
					phone: waitlistSubmission.phone,
					countryRegion: waitlistSubmission.countryRegion,
					consentUpdates: waitlistSubmission.consentUpdates,
					consentUpdatesAt: waitlistSubmission.consentUpdatesAt,
					primaryApplication: waitlistSubmission.primaryApplication,
					evaluationTimeline: waitlistSubmission.evaluationTimeline,
					currentApproach: waitlistSubmission.currentApproach,
					economicImpact: waitlistSubmission.economicImpact,
					budgetRange: waitlistSubmission.budgetRange,
					adoptionEvidence: waitlistSubmission.adoptionEvidence,
					pilotInterest: waitlistSubmission.pilotInterest,
					deploymentScale: waitlistSubmission.deploymentScale,
					contactPermission: waitlistSubmission.contactPermission,
					contactMethod: waitlistSubmission.contactMethod,
					researchPreferences: waitlistSubmission.researchPreferences,
					qualificationStep: waitlistSubmission.qualificationStep,
					createdAt: waitlistSubmission.createdAt,
					updatedAt: waitlistSubmission.updatedAt
				})
				.from(waitlistSubmission)
				.where(
					inArray(
						waitlistSubmission.leadId,
						leads.map((lead) => lead.id)
					)
				)
		: [];

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
		// stable, so the SQL's newest-first ordering survives as the within-band tiebreak.
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
