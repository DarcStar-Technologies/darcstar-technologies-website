import { desc, eq } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { getAuth } from '$lib/server/auth';
import { waitlist } from '$lib/server/db/schema';
import { isStaff } from '$lib/server/admin-access';
import { classifyWaitlistLead } from '$lib/server/waitlist-classify';
import { readWaitlistFunnelCounts, signupConversionRate } from '$lib/server/waitlist-funnel';
import { findAccountByEmail, markWaitlistInvited } from '$lib/server/waitlist-invite';
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
import { waitlistInviteState } from '$lib/waitlist-invite';
import type { PageServerLoad } from './$types';

// Triage view of waitlist signups (sibling of /admin submissions). Reached only past the /admin route
// guard (../+layout.server.ts), so this inherits the isStaff gate. Cap the read — a triage list, not
// an archive; the UI notes when it's showing only the most recent slice.
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

	const rows = await db
		.select({
			id: waitlist.id,
			email: waitlist.email,
			name: waitlist.name,
			company: waitlist.company,
			role: waitlist.role,
			companySize: waitlist.companySize,
			interest: waitlist.interest,
			hearAbout: waitlist.hearAbout,
			phone: waitlist.phone,
			countryRegion: waitlist.countryRegion,
			consentUpdates: waitlist.consentUpdates,
			primaryApplication: waitlist.primaryApplication,
			evaluationTimeline: waitlist.evaluationTimeline,
			currentApproach: waitlist.currentApproach,
			economicImpact: waitlist.economicImpact,
			budgetRange: waitlist.budgetRange,
			adoptionEvidence: waitlist.adoptionEvidence,
			pilotInterest: waitlist.pilotInterest,
			deploymentScale: waitlist.deploymentScale,
			contactPermission: waitlist.contactPermission,
			contactMethod: waitlist.contactMethod,
			researchPreferences: waitlist.researchPreferences,
			qualificationStep: waitlist.qualificationStep,
			// Invite-only onboarding state (DAR-67). `invitedBy` is a staff user id rather than a name —
			// the roster lives behind a different query and this is a breadcrumb, not a byline.
			invitedAt: waitlist.invitedAt,
			invitedBy: waitlist.invitedBy,
			activatedAt: waitlist.activatedAt,
			createdAt: waitlist.createdAt,
			updatedAt: waitlist.updatedAt
		})
		.from(waitlist)
		.orderBy(desc(waitlist.createdAt))
		.limit(WAITLIST_LIMIT);

	// Classification is COMPUTED ON READ, never stored (see waitlist-classify.ts): it's a pure
	// function of columns already here, so a denormalized copy would only add a migration and a
	// recompute obligation on every step write. `row` carries the money columns too — the classifier's
	// input type simply doesn't have them, which is the guardrail.
	const classified = rows.map((row) => ({
		...row,
		leadClass: classifyWaitlistLead(row),
		// Derived here, beside the lead class and for the same reason (DAR-65): it's a pure function of
		// two columns already on the row, so storing it would buy a migration and a recompute obligation
		// and nothing else.
		inviteState: waitlistInviteState(row)
	}));

	// Counts over the WHOLE window, before filtering, so the chips keep showing the full picture
	// while a filter is applied.
	const counts = Object.fromEntries(
		WAITLIST_LEAD_CLASSES.map((leadClass) => [
			leadClass,
			classified.filter((row) => row.leadClass === leadClass).length
		])
	) as Record<WaitlistLeadClass, number>;

	const filter = asLeadClass(url.searchParams.get('class'));
	const signups = (
		filter === null ? [...classified] : classified.filter((row) => row.leadClass === filter)
	)
		// Priority first so an A lead can't be buried under 199 newer subscribers. Array.sort is
		// stable, so the SQL's newest-first ordering survives as the within-band tiebreak.
		.sort((a, b) => waitlistLeadClassRank(a.leadClass) - waitlistLeadClassRank(b.leadClass));

	const funnelCounts = await funnel;

	return {
		signups,
		counts,
		filter,
		total: classified.length,
		limit: WAITLIST_LIMIT,
		funnel: funnelCounts,
		// The primary metric, resolved server-side beside the counts it comes from so the view can't
		// compute a different one. Null when nothing has been viewed yet — a rate needs a denominator —
		// and equally null when the readout itself is unavailable.
		conversion: funnelCounts === null ? null : signupConversionRate(funnelCounts)
	};
};

export const actions: Actions = {
	// Delete a signup — staff (admin + operator). SvelteKit does NOT run the layout guard before a
	// form action (only on the re-render), so authorize here; readEnv + getDb read request-scoped env,
	// so call them before the first await. Idempotent: a missing/already-deleted id is a no-op.
	delete: async ({ request, locals }) => {
		if (!isStaff(locals.user, readEnv('ADMIN_USER_IDS'))) {
			return fail(403, { error: 'forbidden' as const });
		}
		const db = getDb();
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing' as const });
		await db.delete(waitlist).where(eq(waitlist.id, id));
		return { ok: true as const };
	},

	// Invite a prospect to create an account (DAR-67). Public sign-up is closed, so this is one of the
	// only two ways an account comes into existence (the other is the /admin/users roster).
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

		const [row] = await db
			.select({ email: waitlist.email, name: waitlist.name })
			.from(waitlist)
			.where(eq(waitlist.id, id))
			.limit(1);
		// Deleted from under the operator between render and click.
		if (!row) return fail(404, { invite: { error: 'not_found' as const } });

		const existing = await findAccountByEmail(db, row.email, adminIds);

		// Refuse to mail a set-password link to a colleague. The link is a password-reset token, so an
		// operator could otherwise use the invite button to fire a credential-reset mail at an admin's
		// inbox just by adding that address to the waitlist. It is not a takeover (the mail goes to the
		// account's own address, which the operator does not control), but it is an unnecessary primitive
		// and a confusing email; staff accounts are managed on /admin/users.
		if (existing?.isStaff) return fail(400, { invite: { error: 'staff_account' as const } });

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

			// Claim their earlier anonymous contact submissions, same vouch as the roster path (#96) — so
			// the messages they sent before having an account are waiting at /account when they arrive.
			// Best-effort: a link failure must not fail an already-created account.
			try {
				await linkSubmissionsToUser(db, userId, row.email);
			} catch (err) {
				console.error('[invite] linking submissions to the invited account failed', err);
			}
		}

		const link = await mintActivationLink(auth, userId);

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
			JSON.stringify({ waitlistId: id, email: row.email, userId, invitedBy: actorId, created })
		);

		return { invite: { ok: true as const, email: row.email, created } };
	}
};
