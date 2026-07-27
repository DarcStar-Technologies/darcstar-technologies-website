// Invite → activation smoke test (DAR-80) — the authenticated half of DAR-67.
//
// Every PIECE of invite-only onboarding is unit-tested (activation.spec.ts mints and redeems a token,
// waitlist-invite.spec.ts pins the UPDATE predicates, activation-email.spec.ts the message,
// page.svelte.spec.ts the badges), and the e2e suite is hermetic by design — no session cookie and no
// reachable database — so it can only assert that /admin/waitlist redirects a stranger. What nothing
// covered until this script is the pieces IN COMPOSITION, on the real Workers runtime:
//
//   * `getAuth().$context` resolving inside workerd (nothing else in the codebase touches `$context`),
//   * `auth.api.createUser` succeeding as a trusted server-side call with NO forwarded headers,
//   * the account landing with role `user`, `email_verified`, and no `credential` account at all,
//   * the emailed token being redeemable by the ordinary /reset-password flow, a week out,
//   * `onPasswordReset` firing on that redemption and stamping `activated_at`,
//   * the Resend send actually being awaited, so a failure surfaces to the operator.
//
// Like `smoke:signin` it drives the REAL endpoints over HTTP (no browser) and is run BY HAND, not in
// CI: it needs a real Resend key and a real database.
//
//   pnpm build && pnpm preview                                            # one shell
//   ADMIN_EMAIL=you@darcstar.tech ADMIN_PASSWORD='…' pnpm smoke:invite    # another
//
// Prereqs: a staff account to press the button (`pnpm admin:create`), DATABASE_* + RESEND_API_KEY in
// `.env` (the same file `wrangler dev` loads, which is what makes the script and the worker agree on
// a database), and the schema pushed. Exits non-zero on the first failed assertion.
//
// WHERE THE MAIL GOES. The invitee defaults to `delivered@resend.dev`, Resend's own test recipient:
// the send is a real API call that shows up in the Resend logs, but nothing lands in a human's inbox.
// Override with SMOKE_INVITE_EMAIL only for a mailbox you own — the activation email has a static
// subject, so a run against a real address threads with every other test send. (Resend supports
// labels, so `delivered+two@resend.dev` gives a second run its own identity.)
//
// WHY THE WAITLIST ROW IS SEEDED DIRECTLY rather than POSTed to /waitlist, which the ticket left
// open: going through the public form would fire the v1 notification to info@ plus an ack bouncing
// off a synthetic address, and it would run into step 1's per-IP row-count throttle on about the
// third consecutive run — a flake in a script whose whole value is that a red result means something.
// The public form already has hermetic e2e coverage; the invite path is what has none.
//
// WHY IT'S A SEPARATE SCRIPT rather than more of `smoke-signin.mjs`: this one cannot run without a
// database handle and a Resend key, and bundling it would make the sign-in smoke unrunnable for
// anyone holding neither. The HTTP plumbing they do share lives in smoke-http.mjs.
//
// THE ONE HOP NOT COVERED is Better Auth's GET /api/auth/reset-password/:token callback — the link in
// the email. It used to be unreachable twice over: the link is built from `ctx.baseURL` (the ORIGIN
// env var, not this checkout's port), and `isAuthPath()` dropped any request whose origin wasn't
// ORIGIN, so /api/auth/* 404'd before any auth logic ran. DAR-81 fixed both — `pnpm preview` now
// derives ORIGIN from the port it binds, so the link points at the preview AND the callback is
// mounted — and covering it here is simply not done yet. Meanwhile the script POSTs the token
// straight to /reset-password, which is exactly what the invitee's browser does once that callback
// has handed the token over.
//
// TypeScript (run under tsx, like `admin:create`) so it can import the REAL drizzle schema instead of
// hand-writing SQL that would drift from it — and so `pnpm check` type-checks it in CI, which is the
// only automated signal a hand-run script gets.

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/lib/server/db/schema';
import { ACTIVATION_TOKEN_TTL_SECONDS } from '../src/lib/server/auth-options';
import { cookieHeader, die, formPost, ok, signIn, smokeBase } from './smoke-http.mjs';

// DB credentials come from .env — the same source `wrangler dev` reads, so the script and the worker
// under test are looking at one database. Inline/ambient values still win.
try {
	process.loadEnvFile('.env');
} catch {
	// no .env — rely on the ambient environment
}

const BASE = smokeBase();
const staffEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const staffPassword = process.env.ADMIN_PASSWORD;
const inviteeEmail = (process.env.SMOKE_INVITE_EMAIL || 'delivered@resend.dev')
	.trim()
	.toLowerCase();
const inviteePassword = process.env.SMOKE_INVITE_PASSWORD || 'smoke-invitee-pw-123';
const databaseUrl = process.env.DATABASE_URL;
const databaseAuthToken = process.env.DATABASE_AUTH_TOKEN;

if (!staffEmail || !staffPassword) {
	die(
		'ADMIN_EMAIL and ADMIN_PASSWORD are required (the staff account that presses Invite) — e.g. ADMIN_EMAIL=you@… ADMIN_PASSWORD=… pnpm smoke:invite'
	);
}
if (!databaseUrl) die('DATABASE_URL is not set (check .env) — this script asserts against the DB.');
if (inviteeEmail === staffEmail) {
	die(
		'SMOKE_INVITE_EMAIL must not be the staff account — the script deletes the invitee at the end.'
	);
}

// This script writes to the database DIRECTLY as well as through the app, so the two must be the same
// database. `.env` names the DEV one; a base pointing anywhere else pairs the app with a database the
// teardown is not talking to. Step 4 would notice (the seeded lead simply wouldn't render), but the
// teardown deletes rows either way, so make the operator say it out loud.
const host = new URL(BASE).hostname;
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
	if (process.env.SMOKE_ALLOW_REMOTE !== '1') {
		die(
			`refusing to run against ${BASE}: it writes to the DB in .env, which a remote target may not share. Set SMOKE_ALLOW_REMOTE=1 if that is really what you want.`
		);
	}
}

const db = drizzle(createClient({ url: databaseUrl, authToken: databaseAuthToken }), { schema });

const lowerLeadEmail = sql`lower(${schema.waitlistLead.email})`;
const lowerUserEmail = sql`lower(${schema.user.email})`;

/** Better Auth namespaces reset tokens by prefixing the `verification` identifier (activation.ts). */
const RESET_TOKEN_PREFIX = 'reset-password:';

// Two different names on two submissions for one person, which is the point: DAR-88 takes the
// invitation's greeting from the EARLIEST submission that supplied a name, so that a stranger adding
// a later submission for a known address can't choose how we address the real person. The account's
// `name` is where that decision becomes observable from outside.
const EARLIEST_NAME = 'Ada Smoke';
const LATER_NAME = 'Mallory Smoke';

// FIXED ids for both leads this script seeds, so that every lead it deletes is keyed on an id only
// this script ever writes. Two properties come out of that, and both are load-bearing:
//
//   1. A mistyped SMOKE_INVITE_EMAIL cannot destroy a real signup. Deleting leads by ADDRESS was the
//      obvious implementation and it is quietly dangerous: the account guard in `purgeInvitee` is no
//      help, because a genuine prospect has no account to check the role of — they are a waitlist row
//      and nothing else. Under DAR-88 those rows are an append-only record of what people told us,
//      which makes deleting the wrong one unrecoverable. Now the script refuses instead (see the
//      "already on the waitlist" check below).
//   2. A run that dies before its teardown is recoverable. Its rows are findable next time by id,
//      where a random id would strand them — which for the staff lead also meant silently flipping
//      every later run onto the borrow-an-existing-lead branch.
//
// The staff-refusal case (step 10) needs a lead whose address holds a staff account, i.e. the
// operator's OWN address, which may legitimately already be on the waitlist — so that one is BORROWED
// when it exists and seeded under this id when it doesn't.
const SMOKE_INVITEE_LEAD_ID = '5304e0ff-0000-4000-8000-000000000001';
const SMOKE_STAFF_LEAD_ID = '5304e0ff-0000-4000-8000-000000000002';

const findUser = async (email: string) =>
	(
		await db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				role: schema.user.role,
				emailVerified: schema.user.emailVerified,
				banned: schema.user.banned
			})
			.from(schema.user)
			.where(eq(lowerUserEmail, email))
			.limit(1)
	).at(0);

const findLead = async (id: string) =>
	(
		await db
			.select({
				email: schema.waitlistLead.email,
				invitedAt: schema.waitlistLead.invitedAt,
				invitedBy: schema.waitlistLead.invitedBy,
				activatedAt: schema.waitlistLead.activatedAt
			})
			.from(schema.waitlistLead)
			.where(eq(schema.waitlistLead.id, id))
			.limit(1)
	).at(0);

const credentialAccounts = async (userId: string) =>
	db
		.select({ id: schema.account.id })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')));

/**
 * Remove everything a previous run of this script may have left behind for `email`.
 *
 * Runs BEFORE the lifecycle, not only after it: a run that dies halfway leaves an account and a lead
 * in place, and the next run would then be inviting an address that already has an account — testing
 * a different branch than the one it reports on. Self-healing beats a tidy exit that never happens.
 *
 * Children are deleted explicitly rather than left to the schema's `on delete cascade`. The cascade
 * is real, but this is the path that has to work when the database is in a state nobody predicted.
 *
 * NOT deleted: the `login_audit` rows the run's sign-ins produce. They record attempts that genuinely
 * happened, which is the whole point of an audit table, and the FK is `on delete set null`, so they
 * survive the account's removal as anonymous history rather than blocking it.
 */
async function purgeInvitee(email: string): Promise<void> {
	const existing = await findUser(email);
	if (existing) {
		// A guard on SMOKE_INVITE_EMAIL, not on our own rows. The invite mints role `user` and nothing
		// else, so that is the ONLY role a leftover of this script can have; anything else — a staff
		// role, or the null of a pre-admin-plugin account — belongs to a person, and deleting it is the
		// one irreversible thing this script could do to someone who mistyped an override.
		if (existing.role !== 'user') {
			die(
				`refusing to touch ${email}: it holds a ${JSON.stringify(existing.role)}-role account, which this script did not create. SMOKE_INVITE_EMAIL must be a throwaway address.`
			);
		}
		await db.delete(schema.verification).where(eq(schema.verification.value, existing.id));
		await db.delete(schema.session).where(eq(schema.session.userId, existing.id));
		await db.delete(schema.account).where(eq(schema.account.userId, existing.id));
		await db.delete(schema.user).where(eq(schema.user.id, existing.id));
	}
	// By ID, never by address — see SMOKE_INVITEE_LEAD_ID.
	await deleteLead(SMOKE_INVITEE_LEAD_ID);
}

/** Delete a lead and its submissions. Explicit, for the reason `purgeInvitee` gives. */
async function deleteLead(id: string): Promise<void> {
	await db.delete(schema.waitlistSubmission).where(eq(schema.waitlistSubmission.leadId, id));
	await db.delete(schema.waitlistLead).where(eq(schema.waitlistLead.id, id));
}

// ---------------------------------------------------------------------------------------------
// 1. Reach the preview FIRST, before writing anything. Signing in is the cheapest way to check both
//    things that have to be true — the server answers and the credentials work — and doing it before
//    the seed is what keeps an unreachable preview from leaving rows behind.
// ---------------------------------------------------------------------------------------------
// `die` returns never, so the rejection branch contributes nothing to the type — no annotation, and
// no dependence on which `Response` global this file resolves.
const signedIn = await signIn(BASE, staffEmail, staffPassword).catch((err: unknown) =>
	die(`could not reach ${BASE} — is \`pnpm build && pnpm preview\` running? (${String(err)})`)
);
if (signedIn.status === 429) {
	die('sign-in got 429 even after waiting out the window — try again in a minute.');
}
if (signedIn.status !== 303) {
	die(`sign-in: expected 303, got ${signedIn.status} (wrong credentials?)`);
}
const staffCookie = cookieHeader(signedIn);
if (!/session_token=/.test(staffCookie)) die('sign-in: 303 but no session cookie was set');
const staffUser = await findUser(staffEmail);
if (!staffUser) die(`sign-in succeeded but no user row for ${staffEmail} — wrong database?`);
ok(`signed in as ${staffEmail} (id ${staffUser.id})`);

// ---------------------------------------------------------------------------------------------
// 2. A clean slate, then one prospect with two submissions.
// ---------------------------------------------------------------------------------------------
await purgeInvitee(inviteeEmail);
// Any staff lead a previous run seeded and didn't get to delete. A no-op on the normal path, and it
// can only ever match this script's own row.
await deleteLead(SMOKE_STAFF_LEAD_ID);

// Anything still holding this address is somebody else's row: refuse rather than delete it, and
// refuse rather than let the `lower(email)` unique index reject the insert below with a constraint
// error nobody can act on. This is the check that makes a typo in SMOKE_INVITE_EMAIL cost nothing.
const [foreignLead] = await db
	.select({ id: schema.waitlistLead.id })
	.from(schema.waitlistLead)
	.where(eq(lowerLeadEmail, inviteeEmail))
	.limit(1);
if (foreignLead) {
	die(
		`${inviteeEmail} is already on the waitlist (lead ${foreignLead.id}) and this script did not put it there. SMOKE_INVITE_EMAIL must be a throwaway address — refusing to touch a real signup.`
	);
}

const leadId = SMOKE_INVITEE_LEAD_ID;
await db.insert(schema.waitlistLead).values({ id: leadId, email: inviteeEmail });
// `createdAt` is set explicitly on both rows. The default is a millisecond clock, and two inserts in
// the same millisecond would make "the earliest submission" a coin toss — which is precisely the
// property being asserted.
const now = Date.now();
await db.insert(schema.waitlistSubmission).values([
	{
		id: randomUUID(),
		leadId,
		email: inviteeEmail,
		name: EARLIEST_NAME,
		company: 'Smoke Test Co',
		role: 'engineering-leader',
		interest: 'Formal verification for a control system',
		qualificationStep: 1,
		createdAt: new Date(now - 60_000),
		updatedAt: new Date(now - 60_000)
	},
	{
		id: randomUUID(),
		leadId,
		email: inviteeEmail,
		name: LATER_NAME,
		qualificationStep: 1,
		createdAt: new Date(now),
		updatedAt: new Date(now)
	}
]);
ok(`seeded lead ${leadId} for ${inviteeEmail} with two submissions`);

// ---------------------------------------------------------------------------------------------
// 3. The seeded prospect reaches the triage view. Also the proof that the worker under test and this
//    script are reading the same database — every assertion below straddles the two.
// ---------------------------------------------------------------------------------------------
const triage = await fetch(`${BASE}/admin/waitlist`, {
	headers: { cookie: staffCookie },
	redirect: 'manual'
});
if (triage.status !== 200) die(`/admin/waitlist: expected 200, got ${triage.status}`);
if (!(await triage.text()).includes(inviteeEmail)) {
	die(
		`/admin/waitlist: 200 but ${inviteeEmail} is not listed — is the preview pointed at a different database than .env?`
	);
}
ok('/admin/waitlist lists the seeded prospect');

// ---------------------------------------------------------------------------------------------
// 4. Invite. A 200 re-render carrying the confirmation means the WHOLE action ran: account created,
//    link minted, and the Resend send awaited without throwing — the send is the only outbound mail
//    in the codebase whose failure surfaces, so a red here is a genuine "nothing was emailed".
//
//    Outcomes are matched against the RENDERED English copy, here and below, like smoke-signin's
//    assertions. That couples this script to the message catalog on purpose: what the operator has to
//    see is a sentence, not a status code, and a copy change is a thing worth re-reading a smoke over.
// ---------------------------------------------------------------------------------------------
const invited = await formPost(BASE, '/admin/waitlist?/invite', { id: leadId }, staffCookie);
const invitedBody = await invited.text();
if (invited.status !== 200 || !invitedBody.includes(`Invitation sent to ${inviteeEmail}.`)) {
	// The action's failures are distinct on purpose; surfacing which one arrived saves a log dig.
	// Both a missing key and a rejected send land on the same copy, so name both possibilities.
	const hint = invitedBody.includes('invitation email')
		? ' (the account was created but nothing was mailed — is RESEND_API_KEY in the .env wrangler loaded, and is it valid?)'
		: invitedBody.includes('Nothing was emailed')
			? ' (the action failed before the send — creating the account or minting the link threw; check the preview log)'
			: '';
	die(`invite: expected 200 + the confirmation, got ${invited.status}${hint}`);
}
ok(`invited ${inviteeEmail}`);

// ---------------------------------------------------------------------------------------------
// 5. What the invite left in the database.
// ---------------------------------------------------------------------------------------------
const invitee = await findUser(inviteeEmail);
if (!invitee) die('invite: reported success but no account exists for the prospect');
if (invitee.role !== 'user') {
	die(`invite: the account must be role "user", got ${JSON.stringify(invitee.role)}`);
}
if (!invitee.emailVerified) {
	// Staff vouch by choosing the row; without this the invitee would hit requireEmailVerification's
	// 403 at their first sign-in with nothing in the flow able to send them a verification link.
	die('invite: the account is not email-verified — the invitee could never sign in');
}
// THE no-password PROPERTY. better-auth omits the credential record when createUser is called without
// one, so until the invitee sets their own there is no server-generated password in the database that
// nobody chose. /reset-password creates the record on redemption — asserted again after step 7.
if ((await credentialAccounts(invitee.id)).length !== 0) {
	die('invite: the account already has a credential record — it was created WITH a password');
}
if (invitee.name !== EARLIEST_NAME) {
	die(
		`invite: the account name should come from the earliest submission (${EARLIEST_NAME}), got ${JSON.stringify(invitee.name)}`
	);
}
const afterInvite = await findLead(leadId);
if (!afterInvite?.invitedAt) die('invite: invited_at was not stamped');
if (afterInvite.invitedBy !== staffUser.id) {
	die(
		`invite: invited_by should be the acting staff id ${staffUser.id}, got ${JSON.stringify(afterInvite.invitedBy)}`
	);
}
if (afterInvite.activatedAt !== null)
	die('invite: activated_at must stay null until a password is set');
ok('account is role "user", verified, password-less, named from the earliest submission');
ok('lead is stamped invited (and not activated)');

// ---------------------------------------------------------------------------------------------
// 6. The activation token. The script can't read a mailbox, so it takes the token from the
//    `verification` row the invite wrote — the same row the emailed link points at.
// ---------------------------------------------------------------------------------------------
const [pending] = await db
	.select({
		identifier: schema.verification.identifier,
		expiresAt: schema.verification.expiresAt
	})
	.from(schema.verification)
	.where(
		and(
			eq(schema.verification.value, invitee.id),
			like(schema.verification.identifier, `${RESET_TOKEN_PREFIX}%`)
		)
	)
	.orderBy(desc(schema.verification.createdAt))
	.limit(1);
if (!pending) die('invite: no activation token was written to the verification table');
const token = pending.identifier.slice(RESET_TOKEN_PREFIX.length);
if (!token) die('invite: the verification row carries an empty token');

// An invitation lasts a WEEK, not the self-service reset's hour, and the whole scheme rests on
// better-auth enforcing expiry from this row rather than from `resetPasswordTokenExpiresIn`. The unit
// spec proves the enforcement; this proves the live invite actually stamps the long lifetime.
const lifetimeSeconds = (pending.expiresAt.getTime() - Date.now()) / 1000;
if (Math.abs(lifetimeSeconds - ACTIVATION_TOKEN_TTL_SECONDS) > 600) {
	die(
		`invite: the activation token should last ~${ACTIVATION_TOKEN_TTL_SECONDS}s, got ${Math.round(lifetimeSeconds)}s`
	);
}
ok(`activation token minted, expiring in ~${Math.round(lifetimeSeconds / 86_400)} days`);

// ---------------------------------------------------------------------------------------------
// 7. Redeem it through the ordinary /reset-password flow — the reason the invite mints one of
//    better-auth's own tokens instead of inventing a second credential path. `?invite=1` is what the
//    emailed callback appends, and it swaps the copy to "set your password"; asserting the invite
//    wording proves that flag survives the round trip.
// ---------------------------------------------------------------------------------------------
const redeemed = await formPost(BASE, '/reset-password?invite=1', {
	password: inviteePassword,
	token
});
const redeemedBody = await redeemed.text();
if (redeemed.status !== 200 || !redeemedBody.includes('Your password is set.')) {
	// `/reset-password` is capped at 10/hour/IP (auth-options.ts) and each run spends exactly one, so
	// this is what the eleventh run of an hour looks like. Unlike the sign-in window there is nothing
	// worth waiting out, so name it rather than retry.
	const hint =
		redeemed.status === 429
			? ' — the /reset-password cap is 10/hour/IP, so this is roughly the eleventh run this hour'
			: '';
	die(`redeem: expected 200 + the invite success copy, got ${redeemed.status}${hint}`);
}
ok('redeemed the activation link through /reset-password');

// ---------------------------------------------------------------------------------------------
// 8. What redemption changed: a credential exists, the token is spent, and onPasswordReset stamped
//    the lead. That hook fires for EVERY reset on the site, so the stamp is the proof its WHERE
//    clause matched an actually-invited prospect.
// ---------------------------------------------------------------------------------------------
if ((await credentialAccounts(invitee.id)).length !== 1) {
	die('redeem: the account should now hold exactly one credential record');
}
const spent = await db
	.select({ id: schema.verification.id })
	.from(schema.verification)
	.where(
		and(
			eq(schema.verification.value, invitee.id),
			like(schema.verification.identifier, `${RESET_TOKEN_PREFIX}%`)
		)
	);
if (spent.length !== 0) die('redeem: the activation token is single-use but survived redemption');
const afterActivation = await findLead(leadId);
if (!afterActivation?.activatedAt) {
	die('redeem: activated_at was not stamped — onPasswordReset did not reach markWaitlistActivated');
}
ok('credential created, token consumed, lead stamped activated');

// ---------------------------------------------------------------------------------------------
// 9. The invitee can actually sign in with the password they chose — and lands in the END-USER
//    portal, not the admin area, which is what "the invite only ever mints role `user`" means from
//    the outside. /login always 303s to /admin; the /admin guard is what bounces a non-staff account.
// ---------------------------------------------------------------------------------------------
const inviteeSignIn = await signIn(BASE, inviteeEmail, inviteePassword);
if (inviteeSignIn.status === 429) {
	// `signIn` has already waited the window out once, so this is a bucket somebody else is holding
	// down. Say so rather than reporting it as "the password we just set does not work".
	die('invitee sign-in got 429 even after waiting out the window — try again in a minute.');
}
if (inviteeSignIn.status !== 303) {
	die(`invitee sign-in: expected 303, got ${inviteeSignIn.status}`);
}
const inviteeCookie = cookieHeader(inviteeSignIn);
if (!/session_token=/.test(inviteeCookie))
	die('invitee sign-in: 303 but no session cookie was set');
const inviteeAdmin = await fetch(`${BASE}/admin`, {
	headers: { cookie: inviteeCookie },
	redirect: 'manual'
});
if (inviteeAdmin.status !== 303 || inviteeAdmin.headers.get('location') !== '/account') {
	die(
		`invitee /admin: expected 303 → /account, got ${inviteeAdmin.status} → ${inviteeAdmin.headers.get('location')}`
	);
}
const inviteeAccount = await fetch(`${BASE}/account`, {
	headers: { cookie: inviteeCookie },
	redirect: 'manual'
});
if (inviteeAccount.status !== 200) {
	die(`invitee /account: expected 200, got ${inviteeAccount.status}`);
}
ok('the invitee signs in with their chosen password and reaches /account, not /admin');

// ---------------------------------------------------------------------------------------------
// 10. Refusal one: an address holding a STAFF account. The link is a password-reset token, so the
//     button must not become a way to fire credential mail at a colleague. Cheap to assert and the
//     likeliest of the two to rot, since it depends on `isStaff` agreeing with the roster.
// ---------------------------------------------------------------------------------------------
const [existingStaffLead] = await db
	.select({ id: schema.waitlistLead.id })
	.from(schema.waitlistLead)
	.where(eq(lowerLeadEmail, staffEmail))
	.limit(1);
// Reuse a real lead if the staff address is genuinely on the waitlist — a refused invite writes
// nothing, so borrowing it is safe, and deleting someone's row would not be.
const staffLeadId = existingStaffLead?.id ?? SMOKE_STAFF_LEAD_ID;
if (!existingStaffLead) {
	await db.insert(schema.waitlistLead).values({ id: staffLeadId, email: staffEmail });
	await db.insert(schema.waitlistSubmission).values({
		id: randomUUID(),
		leadId: staffLeadId,
		email: staffEmail,
		name: 'Staff Smoke'
	});
}
const staffLeadBefore = await findLead(staffLeadId);
const staffRefusal = await formPost(
	BASE,
	'/admin/waitlist?/invite',
	{ id: staffLeadId },
	staffCookie
);
const staffRefusalBody = await staffRefusal.text();
if (
	staffRefusal.status !== 400 ||
	!staffRefusalBody.includes('already belongs to a staff account')
) {
	die(`staff refusal: expected 400 + the staff message, got ${staffRefusal.status}`);
}
const staffLeadAfter = await findLead(staffLeadId);
if (staffLeadAfter?.invitedAt?.getTime() !== staffLeadBefore?.invitedAt?.getTime()) {
	die('staff refusal: refused, but invited_at moved — a refusal must write nothing');
}
ok('inviting a staff address is refused, and stamps nothing');

// ---------------------------------------------------------------------------------------------
// 11. Refusal two: a roster-DISABLED account. Setting a password does not lift a ban, so without
//     this the prospect would follow a working link, choose a password, and then be unable to sign
//     in — with nobody in the loop able to see why. `banned` is set DIRECTLY rather than through the
//     roster action that normally sets it: the invite action only reads this column, and driving
//     /admin/users/<id>?/disable would raise this whole script's prerequisite from "a staff account"
//     to "a roster admin" — a stronger requirement than the action under test has. The roster path is
//     smoke:signin's job.
// ---------------------------------------------------------------------------------------------
await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, invitee.id));
const disabledRefusal = await formPost(
	BASE,
	'/admin/waitlist?/invite',
	{ id: leadId },
	staffCookie
);
const disabledBody = await disabledRefusal.text();
if (disabledRefusal.status !== 400 || !disabledBody.includes('That account is disabled')) {
	die(`disabled refusal: expected 400 + the disabled message, got ${disabledRefusal.status}`);
}
const afterDisabled = await findLead(leadId);
if (afterDisabled?.invitedAt?.getTime() !== afterInvite.invitedAt.getTime()) {
	die('disabled refusal: refused, but invited_at moved — a refusal must write nothing');
}
ok('inviting a disabled account is refused, and stamps nothing');

// ---------------------------------------------------------------------------------------------
// 12. Tear down. Only what this run created: the borrowed staff lead (if it was already there) is
//     left alone.
// ---------------------------------------------------------------------------------------------
await purgeInvitee(inviteeEmail);
if (!existingStaffLead) await deleteLead(staffLeadId);
const leftover = await findUser(inviteeEmail);
if (leftover) die('cleanup: the invitee account is still present');
const leftoverLeads = await db
	.select({ id: schema.waitlistLead.id })
	.from(schema.waitlistLead)
	.where(eq(lowerLeadEmail, inviteeEmail));
if (leftoverLeads.length !== 0) die('cleanup: a seeded lead is still present');
ok('cleaned up the invitee account and the seeded leads');

console.log('\n✓ invite → activation smoke test passed');
