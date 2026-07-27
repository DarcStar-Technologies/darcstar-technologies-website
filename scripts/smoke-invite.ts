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
//   * the emailed LINK working end to end — better-auth's GET callback validating the token and
//     handing it on to /reset-password, which redeems it, a week out (DAR-91),
//   * `onPasswordReset` firing on that redemption and stamping `activated_at`,
//   * the Resend send actually being awaited, so a failure surfaces to the operator,
//   * the two anti-enumerating auth endpoints answering identically ON THE WIRE (DAR-91).
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
// A run sends that address TWO emails, not one (DAR-91): the invitation, and then a real "Reset your
// password" from the anti-enumeration probe at step 11, which cannot ask the question without
// triggering the send. That matters for the override and not for the default — unsolicited
// credential-reset mail is exactly what a person should never be trained to ignore. The probe is NOT
// skipped when the override is set: a smoke that asserts less depending on someone's environment is
// the DAR-79/DAR-81 defect (one script testing two different things), so this is disclosed instead.
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
// WHAT THE LINK HOP BUYS (DAR-91). The script used to skip Better Auth's GET
// /api/auth/reset-password/:token callback and POST the token straight to /reset-password — the thing
// the invitee's browser does AFTER the callback has handed the token over. That hop was unreachable
// twice over: the link is built from `ctx.baseURL` (the ORIGIN env var, not this checkout's port), and
// `isAuthPath()` dropped any request whose origin wasn't ORIGIN, so /api/auth/* 404'd before any auth
// logic ran. DAR-81 fixed both, so the script now follows the link and takes the reset URL — path,
// token, `invite` flag — off the callback's `location` header instead of writing it down. The one
// thing it still reconstructs is the LINK itself, because it cannot read a mailbox; see step 7.
//
// WHY THE ANTI-ENUMERATION PROBE LIVES HERE (DAR-91) rather than in `smoke:signin`, whose subject it
// looks closer to. The probe needs an address that HAS an account, and /request-password-reset really
// mails whatever it is asked about — so the address also has to be able to receive. smoke-signin has
// two candidates and both are wrong: the operator's own address (a genuine reset link fired at a
// colleague's inbox every run, which is how people learn to ignore security mail) and the throwaway
// operator it creates at `smoke-op-<ts>@example.com` — and example.com publishes a NULL MX (`0 .`,
// RFC 7505: this domain accepts no mail), so that one manufactures a hard bounce per run on the same
// verified domain the site's real mail leaves from. This script's invitee is `delivered@resend.dev`,
// Resend's test recipient, which accepts and discards: a real send, a real delivery, nobody's inbox.
//
// TypeScript (run under tsx, like `admin:create`) so it can import the REAL drizzle schema instead of
// hand-writing SQL that would drift from it — and so `pnpm check` type-checks it in CI, which is the
// only automated signal a hand-run script gets.

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/lib/server/db/schema';
import { ACTIVATION_TOKEN_TTL_SECONDS, rateLimit } from '../src/lib/server/auth-options';
import { ACTIVATION_CALLBACK_PATH, ACTIVATION_QUERY_FLAG } from '../src/lib/server/activation';
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
// 7. Follow the emailed link (DAR-91). Better Auth's GET /reset-password/:token validates the token
//    and 302s to the reset page carrying it — the hop between "an email arrived" and "a form the
//    invitee can submit", and the one piece of this flow nothing else in the repo exercises.
//
//    THE ONE URL THIS SCRIPT WRITES DOWN, because it cannot read a mailbox: the shape
//    `mintActivationLink` builds, `${ctx.baseURL}/reset-password/<token>?callbackURL=…`, with
//    better-auth's default /api/auth base path (which the /reset-password action hardcodes too). Even
//    that imports the callback path rather than retyping it, and everything downstream — where the
//    browser is sent, which token it carries, whether the invite flag survived — is READ OFF the
//    response. That is the difference between testing the callback and testing our idea of it.
// ---------------------------------------------------------------------------------------------
const previewOrigin = new URL(BASE).origin;
const emailedLink = `${BASE}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(ACTIVATION_CALLBACK_PATH)}`;
const callback = await fetch(emailedLink, { redirect: 'manual' });
if (callback.status !== 302) {
	// 404 is DAR-81's failure mode coming back: better-auth mounts /api/auth only for requests whose
	// origin matches its baseURL, so a preview serving any other ORIGIN has no auth API at all and
	// SvelteKit's router answers instead. Worth naming, because a bare 404 here reads like a typo.
	const hint =
		callback.status === 404
			? " (404 = /api/auth is not mounted on this origin — the preview's ORIGIN must match the port it serves, which `pnpm preview` derives and a hand-rolled `wrangler dev` does not)"
			: '';
	die(`activation link: expected a 302 from the GET callback, got ${callback.status}${hint}`);
}
// Named `locationHeader`, not `location`: a bare `location` shadows a DOM/Worker global, and this
// file is type-checked against the Cloudflare ambient types.
const locationHeader = callback.headers.get('location');
if (!locationHeader) die('activation link: the callback 302d with no location header');
const landing = new URL(locationHeader, BASE);
// THE STATUS PROVES NOTHING BY ITSELF. An expired, spent or malformed token takes the same 302 to the
// same page, distinguished only by `?error=INVALID_TOKEN` (better-auth's redirectError) — and
// /reset-password renders its dead-link panel off exactly that. So the query is the assertion.
if (landing.searchParams.has('error')) {
	die(
		`activation link: the callback rejected the token (error=${landing.searchParams.get('error')})`
	);
}
if (landing.origin !== previewOrigin || landing.pathname !== '/reset-password') {
	die(
		`activation link: expected a redirect to ${previewOrigin}/reset-password, got ${landing.href}`
	);
}
const landedToken = landing.searchParams.get('token');
if (!landedToken) die('activation link: the callback redirected without a token');
if (landedToken !== token) {
	die('activation link: the callback handed on a different token than the one it validated');
}
// The `invite` flag only selects copy, but it rides the callbackURL out through better-auth and back,
// so losing it is silent: the invitee would be told to reset a password they have never had — the
// small lie activation.ts exists to avoid — and nothing but this would notice.
if (!landing.searchParams.has(ACTIVATION_QUERY_FLAG)) {
	die(`activation link: the "${ACTIVATION_QUERY_FLAG}" flag did not survive the callback`);
}
ok('the emailed link validates the token and redirects to the reset page');

// The page that redirect lands on: the last thing between a valid token and a form the invitee can
// submit, and the proof its `load` reads what the callback actually produced.
const landingPage = await fetch(landing, { redirect: 'manual' });
const landingBody = await landingPage.text();
if (landingPage.status !== 200) {
	die(`activation link: ${landing.pathname} returned ${landingPage.status}`);
}
// NOT the heading. "Set your password" is also this page's TITLE, which invite mode renders in all
// three of its states — so the obvious assertion passes just as happily on the dead-link panel. The
// lede is unique to the form branch, and the invalid heading's absence is the fail-closed half.
if (!landingBody.includes('Choose a password to finish setting up your account.')) {
	die('activation link: the reset page did not render the invitation form');
}
if (landingBody.includes('This link is invalid or expired')) {
	die(
		'activation link: the reset page showed the dead-link panel for a token the callback accepted'
	);
}
// The hidden field is what a no-JS submit actually sends. Matched as an attribute rather than as a
// bare substring because the token is in this page's URL, and therefore in its own og:url tag.
if (!landingBody.includes(`value="${landedToken}"`)) {
	die('activation link: the reset page did not seed its hidden token field');
}
ok('the reset page renders the invitation form with the token in place');

// ---------------------------------------------------------------------------------------------
// 8. Redeem it through the ordinary /reset-password flow — the reason the invite mints one of
//    better-auth's own tokens instead of inventing a second credential path. Posting to the URL the
//    callback produced, carrying the token it handed over, is what makes this the invitee's path
//    rather than a reconstruction of it; the invite success copy proves the flag survives the native
//    re-render as well as the redirect. DAR-91 REPLACED the hand-written POST that used to stand here
//    rather than keeping both — the token is single-use, so a second attempt could only ever fail.
// ---------------------------------------------------------------------------------------------
const redeemed = await formPost(BASE, `${landing.pathname}${landing.search}`, {
	password: inviteePassword,
	token: landedToken
});
const redeemedBody = await redeemed.text();
if (redeemed.status !== 200 || !redeemedBody.includes('Your password is set.')) {
	// `/reset-password` is capped per hour (auth-options.ts) and each run spends exactly one, so this
	// is what a long afternoon of runs looks like. Unlike the sign-in window there is nothing worth
	// waiting out — against `pnpm preview` the counters are in memory (DAR-81), so a restart is the
	// fix — which is why this names the cap rather than retrying.
	const hint =
		redeemed.status === 429
			? ` — the /reset-password cap is ${rateLimit.customRules['/reset-password'].max}/hour and each run spends one; restart \`pnpm preview\` to clear the in-memory counters (DAR-81)`
			: '';
	die(`redeem: expected 200 + the invite success copy, got ${redeemed.status}${hint}`);
}
ok('redeemed the activation link through /reset-password');

// ---------------------------------------------------------------------------------------------
// 9. What redemption changed: a credential exists, the token is spent, and onPasswordReset stamped
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
// 10. The invitee can actually sign in with the password they chose — and lands in the END-USER
//     portal, not the admin area, which is what "the invite only ever mints role `user`" means from
//     the outside. /login always 303s to /admin; the /admin guard is what bounces a non-staff account.
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
// 11. Anti-enumeration, ON THE WIRE (DAR-91). Two public endpoints answer questions about an address
//     — "mail this account a reset link", "mail this account a verification link" — and both are
//     supposed to be indistinguishable for an address that has an account and one that cannot. That
//     claim was only ever asserted at the `auth.api.*` level in unit tests, which is a claim about a
//     function's return value, not about what a stranger with curl can observe.
//
//     It runs in THIS script because the known-good address has to be able to receive real mail
//     without bouncing (see the header), and it runs AFTER the redemption because
//     /request-password-reset mints its own `reset-password:` verification row: probing earlier would
//     leave one behind and fail step 9's "the activation token is single-use" check against a row
//     that was never the activation token.
//
//     The probes must also be ANONYMOUS — not a placement decision, a construction one. With a
//     session cookie /send-verification-email takes a completely different branch
//     (EMAIL_MISMATCH / EMAIL_ALREADY_VERIFIED) and enumerates nothing because it answers nothing.
//
//     Only the better-auth endpoints are probed, not our /forgot-password and /login?/resend
//     wrappers. Those discard the upstream response and return one fixed outcome for every non-429,
//     so they are uniform by construction — whereas upstream's uniformity is a behaviour an upgrade
//     could quietly drop. Probing both would also spend the same per-hour bucket twice.
// ---------------------------------------------------------------------------------------------
// The address that CANNOT have an account: random, so no run can collide with a real signup, and at
// example.com, whose null MX means nothing could be delivered there even if the endpoint tried. It
// won't — no account, no send — which is the point: only the known-good half of each pair mails.
const stranger = `no-such-account-${randomUUID()}@example.com`;

/** POST JSON straight at a better-auth endpoint, anonymously, and keep exactly what came back. */
async function authProbe(path: string, body: unknown) {
	const res = await fetch(`${BASE}/api/auth${path}`, {
		method: 'POST',
		redirect: 'manual',
		headers: { 'content-type': 'application/json', origin: previewOrigin },
		body: JSON.stringify(body)
	});
	return { status: res.status, body: await res.text() };
}

/**
 * Ask `path` about an address that has an account and one that cannot, and require the two answers
 * to be identical. Typed against the rate-limit rules so a renamed endpoint is a `pnpm check` error
 * rather than a probe that quietly tests a 404.
 */
async function assertIndistinguishable(
	path: keyof typeof rateLimit.customRules,
	build: (email: string) => unknown
): Promise<void> {
	const known = await authProbe(path, build(inviteeEmail));
	const unknown = await authProbe(path, build(stranger));

	// The SHAPE first, and this ordering is the point: "the two responses match" is satisfied by two
	// 429s and by two 500s just as happily as by two successes. That is DAR-81's lesson — a guard
	// that passes hardest when nothing works at all — so the endpoint has to be seen answering
	// before its answers are compared.
	for (const [label, probe] of [
		['an account', known],
		['a stranger', unknown]
	] as const) {
		if (probe.status === 429) {
			die(
				`${path}: ${label} got 429 — the cap is ${rateLimit.customRules[path].max}/hour and this probe spends two. Restart \`pnpm preview\` to clear the in-memory counters (DAR-81), or wait out the window.`
			);
		}
		if (probe.status !== 200) {
			die(`${path}: ${label} expected 200, got ${probe.status} — ${probe.body.slice(0, 200)}`);
		}
	}
	if (known.body !== unknown.body) {
		die(
			`${path}: an account and a stranger get DIFFERENT answers — the endpoint enumerates.\n    account:  ${known.body.slice(0, 200)}\n    stranger: ${unknown.body.slice(0, 200)}`
		);
	}
	ok(`${path} answers identically for an account and a stranger`);
}

await assertIndistinguishable('/request-password-reset', (email) => ({
	email,
	redirectTo: '/reset-password'
}));
// The invitee is verified by now, so this one mails nothing for either address — the leak it guards
// against is the classic "no such user" vs "already verified" split, not a send.
await assertIndistinguishable('/send-verification-email', (email) => ({
	email,
	callbackURL: '/account'
}));

// ---------------------------------------------------------------------------------------------
// 12. Refusal one: an address holding a STAFF account. The link is a password-reset token, so the
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
// 13. Refusal two: a roster-DISABLED account. Setting a password does not lift a ban, so without
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
// 14. Tear down. Only what this run created: the borrowed staff lead (if it was already there) is
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
