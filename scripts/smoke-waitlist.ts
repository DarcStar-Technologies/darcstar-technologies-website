// Waitlist v2 flow smoke test (DAR-103) — the whole progressive flow driven against a REAL database.
//
// Every piece of this flow is unit-tested and the page is covered by a hermetic Playwright suite, and
// between them they still never observe the thing that matters: a step's UPDATE landing on the row its
// token addresses. The two suites each cover a half and neither covers the join —
//
//   * unit specs round-trip mint → verify INSIDE one module, with the secret passed in as a parameter.
//     Real, and hermetic by construction: no request, no database, no second module.
//   * e2e builds and previews the actual Cloudflare bundle, but with a placeholder DATABASE_URL. The
//     enrich and the funnel insert are fire-and-forget and swallow their own failures, so they are
//     no-ops there BY DESIGN — that is exactly what keeps the suite hermetic and green — and it reaches
//     the token-gated steps through the honeypot's decoy token, which addresses no row at all. The
//     continuation token and flow claim are asserted only by SHAPE in the rendered hidden fields
//     (`/^v1\./`, `/^f1\./`), never by being verified by anything.
//
// So this script is the only place the following are observed at all, and each is a composition rather
// than a unit:
//
//   * a step's UPDATE reaching the submission its token names, one column set per step (DAR-59…DAR-63),
//   * the /waitlist load and the four step endpoints agreeing on the signing secret across a real
//     request boundary — the four signed values are minted in one module and verified in another, and
//     DAR-99's brand makes a mismatch a compile error only for code inside `src`; nothing proves the
//     RUNNING worker's mint and verify agree except a token minted by one and accepted by the other,
//   * `waitlist_funnel_event` rows appearing under the flow the page minted, at most one per
//     `(flow_id, event)` however many times a step is replayed (DAR-66's composite key), and NONE for a
//     flow id the caller invented (DAR-86),
//   * DAR-68's per-row write budget counting real writes and then refusing SILENTLY,
//   * DAR-88's append-only insert putting a second submission under the same lead,
//   * `classifyWaitlistLeadGroup` reading what the steps actually wrote,
//   * DAR-82's `priority_a_notified_at` conditional UPDATE claiming exactly once,
//   * DAR-75's resume cookie re-minting a token and a flow claim on a plain GET.
//
// Like `smoke:signin` and `smoke:invite` it drives the REAL endpoints over HTTP with no browser, and is
// run BY HAND rather than in CI, because it needs a reachable database:
//
//   pnpm build && pnpm preview     # one shell
//   pnpm smoke:waitlist            # another
//
// Prereqs: `DATABASE_*` and `BETTER_AUTH_SECRET` in `.env` — the same file `wrangler dev` loads, which
// is what makes the script and the worker under test agree on a database and a secret — and the schema
// pushed (`pnpm db:push`). Exits non-zero on the first failed assertion.
//
// WHY IT SEEDS THE LEAD BEFORE THE FIRST SIGNUP, rather than letting the first POST create it. A signup
// that is genuinely new fires two emails (waitlist-notify.ts): the lead notification into info@ and an
// ack to the submitter. Both are gated on `isNew`, which is the LEAD insert winning — so seeding the
// lead first makes every submission in the run a repeat, and neither send happens. That is not a dodge
// around the code under test: a repeat email under an existing lead is precisely DAR-88's append-only
// case, and it is what steps D and L assert. What it costs is the `isNew` email gate itself, which is
// not observable from outside the process anyway (the only evidence is mail arriving), and which
// `waitlist-store.spec.ts` covers at the unit level.
//
// A RUN SENDS TWO EMAILS, and both are disclosed rather than suppressed.
//
//   1. DAR-82's Priority-A notification, once, into info@ — subject
//      `Priority A waitlist lead: <the smoke address>`. The step-4A answers below classify Priority A
//      on purpose, that being the point of step I.
//   2. DAR-139's updates confirmation, once, to the smoke address itself — because step 1 ticks the
//      opt-in box, which is what step N exists to walk.
//
// Neither can be separated from the claim it belongs to, and for the same reason: both
// `captureWaitlistPriorityLead` and `captureUpdatesConsent` check the Resend key BEFORE they claim, so
// a run that sends nothing is a run where the column was never stamped and the assertion inverts into
// its weaker half. Skipping a send under an env flag would be DAR-79/DAR-81's defect again (one script
// testing two different things depending on whose machine it is on).
//
// The second one goes to `delivered@resend.dev` unless SMOKE_WAITLIST_EMAIL says otherwise — Resend's
// own test recipient, so it is a real send that lands in nobody's inbox. Point that variable at a real
// mailbox and you will get a real "confirm your updates" email; that is the intended way to eyeball the
// message, and it is why the default is what it is.
//
// WHY THE FUNNEL IS ANCHORED BY TIME AND NOT BY A PARSED HANDLE. The flow id travels signed
// (`n1.<uuid>.<exp>.<mac>`, DAR-86) and the column holds the bare UUID, so the obvious way to find this
// run's rows is to split the handle on '.' and take the payload. This script deliberately does not: it
// is a CLIENT, and a client that can take a signed value apart is one that will eventually be tempted
// to put one together. Instead it reads the database's own clock before it starts and asserts that
// every funnel row written since then belongs to exactly ONE flow — which is a stronger claim than
// "our rows are there" (it also catches a second flow being minted mid-run, DAR-75's `__data.json`
// over-count) and needs no knowledge of the wire format at all. The cost is that a second person
// driving /waitlist against the same database during the run makes it fail; it says so when it does.
//
// TypeScript (run under tsx, like `admin:create` and `smoke:invite`) so it can import the REAL drizzle
// schema, the REAL classifier and the REAL budget constant instead of restating them — and so
// `pnpm check` type-checks it against all three on every PR, which is the only automated signal a
// hand-run script gets.

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq, gte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/lib/server/db/schema';
import {
	classifyWaitlistLead,
	classifyWaitlistLeadGroup
} from '../src/lib/server/waitlist-classify';
import { readUpdatesAudience, WAITLIST_STEP_WRITE_MAX } from '../src/lib/server/waitlist-store';
import { WAITLIST_RESUME_COOKIE } from '../src/lib/server/waitlist-resume';
import {
	mintUpdatesConfirmToken,
	mintUpdatesUnsubscribeToken
} from '../src/lib/server/waitlist-updates-token';
import {
	UPDATES_CONFIRM_PATH,
	UPDATES_UNSUBSCRIBE_PATH
} from '../src/lib/server/waitlist-updates-notify';
import { mayReceiveUpdates, waitlistUpdatesState } from '../src/lib/waitlist-updates';
import type { WaitlistSigningSecret } from '../src/lib/server/waitlist-secret';
import type { Db } from '../src/lib/server/db';
import { die, ok, smokeBase } from './smoke-http.mjs';

// DB credentials come from .env — the same source `wrangler dev` reads, so the script and the worker
// under test are looking at one database. Inline/ambient values still win.
try {
	process.loadEnvFile('.env');
} catch {
	// no .env — rely on the ambient environment
}

const BASE = smokeBase();
const ORIGIN = new URL(BASE).origin;
const databaseUrl = process.env.DATABASE_URL;
const databaseAuthToken = process.env.DATABASE_AUTH_TOKEN;

// Resend's own test recipient by default: a real send that lands in nobody's inbox. Only the ACK would
// ever go here (and the seeded lead means it doesn't), but the default matters anyway — it is what
// makes a mistake in the seeding cost nothing, and it is the address that ends up in the Priority-A
// notification's subject line.
const smokeEmail = (process.env.SMOKE_WAITLIST_EMAIL || 'delivered@resend.dev')
	.trim()
	.toLowerCase();

if (!databaseUrl) die('DATABASE_URL is not set (check .env) — this script asserts against the DB.');

// This script writes to the database DIRECTLY as well as through the app, so the two must be the same
// database. `.env` names the DEV one; a base pointing anywhere else pairs the app with a database the
// teardown is not talking to. Make the operator say it out loud. (Same guard as smoke-invite.ts.)
const host = new URL(BASE).hostname;
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
	if (process.env.SMOKE_ALLOW_REMOTE !== '1') {
		die(
			`refusing to run against ${BASE}: it writes to the DB in .env, which a remote target may not share. Set SMOKE_ALLOW_REMOTE=1 if that is really what you want.`
		);
	}
}

const db = drizzle(createClient({ url: databaseUrl, authToken: databaseAuthToken }), { schema });

// The app's own store functions take its `Db` type; this script builds its client directly, so the two
// are structurally identical and nominally different. Cast ONCE, here, rather than at each call site —
// waitlist-store.spec.ts makes the same cast for the same reason.
const appDb = db as unknown as Db;

const lowerLeadEmail = sql`lower(${schema.waitlistLead.email})`;

// A FIXED id for the lead this script seeds, for the two reasons smoke-invite.ts gives: a mistyped
// SMOKE_WAITLIST_EMAIL cannot destroy a real signup (every delete is keyed on an id only this script
// writes), and a run that dies before its teardown leaves rows the next run can still find. Distinct
// from smoke-invite's two so the scripts can never collide.
const SMOKE_LEAD_ID = '5304e0ff-0000-4000-8000-000000000003';

// ---------------------------------------------------------------------------------------------
// The answers. Chosen to walk the LONGEST path — commercial use case → step 3 → branch A → a positive
// pilot answer — because that is the branch with something in every column and the only one that
// reaches DAR-82. Each value is a slug from $lib/waitlist-qualification.
// ---------------------------------------------------------------------------------------------
const STEP1 = {
	name: 'Ada Smoke',
	company: 'Smoke Test Co',
	countryRegion: 'north-america'
} as const;
const STEP2 = {
	role: 'engineering-leader',
	primaryApplication: 'robotics-autonomous-systems',
	evaluationTimeline: 'evaluating-now'
} as const;
const STEP3 = {
	currentApproach: 'internal-system',
	economicImpact: 'over-1m',
	budgetRange: '50k-100k',
	adoptionEvidence: ['evaluation-pilot', 'formal-proof-artifacts']
} as const;
const STEP4A = {
	pilotInterest: 'yes-within-3-months',
	loiReadiness: 'possibly-after-discussion',
	deploymentScale: 'Roughly 20 autonomous ground units across two sites',
	contactMethod: 'email',
	phone: '+1 555 010 0103'
} as const;

// The role sent on the ONE step-2 write the budget is expected to refuse. Different from STEP2's on
// purpose: every column is provided-wins (`coalesce(new, existing)`), so if the refusal were not real
// this value would land, and asserting the column is unchanged is the only way to tell a refused write
// from a permitted one — the response is deliberately identical either way (DAR-68's anti-oracle rule).
const REFUSED_ROLE = 'product-operations';

// ---------------------------------------------------------------------------------------------
// HTTP plumbing. The script is a browser: it carries cookies, it reads every form action and hidden
// field off the page it was given, and it writes down no URL it could have been handed.
// ---------------------------------------------------------------------------------------------

/** The cookie jar. Only the resume cookie matters, but a jar is what a browser has. */
const jar = new Map<string, string>();

const cookieHeader = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

function absorbCookies(res: Response): void {
	for (const raw of res.headers.getSetCookie()) {
		const [pair] = raw.split(';', 1);
		const eq = pair.indexOf('=');
		if (eq < 0) continue;
		const name = pair.slice(0, eq).trim();
		const value = pair.slice(eq + 1).trim();
		// A cleared cookie is an empty value with an expiry in the past; drop it rather than send `=`.
		if (value === '') jar.delete(name);
		else jar.set(name, value);
	}
}

type Page = { status: number; html: string };

/** GET /waitlist as a browser would, carrying whatever cookies the run has collected. */
async function visit(): Promise<Page> {
	const res = await fetch(`${BASE}/waitlist`, {
		redirect: 'manual',
		headers: jar.size ? { cookie: cookieHeader() } : {}
	});
	absorbCookies(res);
	return { status: res.status, html: await res.text() };
}

/**
 * A native (no-JS) remote-form POST — url-encoded, `origin` for SvelteKit's CSRF check, and
 * `accept: text/html` so the answer is the page re-render a browser without JS would get rather than
 * the enhanced JSON response. That is the path this script wants: the re-render carries the next
 * step's hidden fields, which is how the flow is walked at all.
 *
 * `anonymous` sends and keeps NO cookies — a stranger with curl rather than this run's browser. Used
 * once, for the forged-flow probe, and the isolation is the point: that POST must not move the resume
 * cookie the rest of the walk depends on.
 */
async function submit(
	action: string,
	body: Record<string, string | string[]>,
	options: { anonymous?: boolean } = {}
): Promise<Page> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) {
		for (const one of Array.isArray(value) ? value : [value]) params.append(key, one);
	}
	const sendCookies = !options.anonymous && jar.size > 0;
	const res = await fetch(`${BASE}/waitlist${action}`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
			origin: ORIGIN,
			...(sendCookies ? { cookie: cookieHeader() } : {})
		},
		body: params
	});
	if (!options.anonymous) absorbCookies(res);
	return { status: res.status, html: await res.text() };
}

/**
 * A native POST at one of DAR-139's landing pages. Its own helper rather than `submit`, because these
 * are ordinary form actions on their own routes — no `?/remote=` action to read off a page, no resume
 * cookie to carry, and deliberately anonymous: the login-free unsubscribe has to work for somebody who
 * has never had a session, which is most of the people who will ever use it.
 */
async function updatesPost(path: string, token: string): Promise<Page> {
	const res = await fetch(`${BASE}${path}`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			// Without this SvelteKit answers a form action with its ActionResult envelope instead of the
			// page re-render — the same trap smoke-http.mjs documents.
			accept: 'text/html',
			origin: ORIGIN
		},
		body: new URLSearchParams({ token })
	});
	return { status: res.status, html: await res.text() };
}

/**
 * The `action` of the form that posts to `fn`, or null when this page isn't showing that step.
 *
 * READ OFF THE PAGE, never constructed. SvelteKit's remote-form action is `?/remote=<build hash>/<fn>`
 * and the hash changes with the module — writing it down would make this script a thing that needs
 * updating after an unrelated build. Which form is present is also the honest answer to "which step am
 * I on": the step IS its form.
 */
const stepAction = (page: Page, fn: string): string | null =>
	page.html.match(new RegExp(`action="(\\?/remote=[^"]*/${fn})"`))?.[1] ?? null;

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	'#39': "'"
};

/**
 * A hidden field's value, decoded — the token, the flow claim and the flow handle all ride these.
 *
 * ONE PASS, not a chain of `.replace()` calls. A chain has to unescape `&amp;` at some point, and
 * whichever end it sits at is wrong: first, and `&amp;lt;` decodes to `<` (an entity that was never in
 * the document); last, and an `&` produced by an earlier step can be re-consumed. A single regex with
 * a lookup table can't compose its own output, so the question doesn't arise. Today's values are
 * base64url with `.` separators and contain none of these characters, which is exactly why the chain
 * version looked fine and stayed wrong.
 */
function hidden(page: Page, name: string): string {
	const raw = page.html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ?? '';
	return raw.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ENTITIES[entity]);
}

/**
 * `hidden`, but an absent or empty field stops the run where it happened.
 *
 * The step endpoints are ANTI-ORACLE: an unusable token, claim or handle produces the same generic
 * success as a good one. So carrying an empty string forward does not fail here — it fails three
 * assertions later as `expected "evaluating-now", got null`, which reads as "the enrich is broken"
 * when the truth is "the field was never on the page". Every value this script forwards is one the
 * page is required to have rendered, so the honest place to notice is where it was read.
 */
function requiredHidden(page: Page, name: string, label: string): string {
	const value = hidden(page, name);
	if (!value) die(`${label}: the rendered form carries no "${name}" field`);
	return value;
}

/** Assert which step a response is showing, and hand back the action to post the next one to. */
function expectStep(page: Page, fn: string, label: string): string {
	if (page.status !== 200) die(`${label}: expected 200, got ${page.status}`);
	const action = stepAction(page, fn);
	if (!action) {
		const showing =
			[
				'joinWaitlist',
				'submitWaitlistStep2',
				'submitWaitlistStep3',
				'submitWaitlistStep4A',
				'submitWaitlistStep4B'
			].find((candidate) => stepAction(page, candidate)) ?? 'no step form at all';
		die(`${label}: expected the ${fn} form, but the page is showing ${showing}`);
	}
	return action;
}

// ---------------------------------------------------------------------------------------------
// Database helpers.
// ---------------------------------------------------------------------------------------------

/**
 * The database's OWN clock. Every funnel query below is anchored to this rather than to `Date.now()`:
 * the rows are stamped by SQLite (`unixepoch`) on a Turso host, and a few seconds of skew against this
 * machine's clock would either hide this run's first rows or admit the previous run's last ones.
 */
async function dbNow(): Promise<number> {
	const [row] = await db.all<{ now: number }>(
		sql`select cast(unixepoch('subsecond') * 1000 as integer) as now`
	);
	return row.now;
}

const submissionsForLead = () =>
	db
		.select()
		.from(schema.waitlistSubmission)
		.where(eq(schema.waitlistSubmission.leadId, SMOKE_LEAD_ID))
		.orderBy(schema.waitlistSubmission.createdAt);

const leadRow = async () =>
	(
		await db
			.select()
			.from(schema.waitlistLead)
			.where(eq(schema.waitlistLead.id, SMOKE_LEAD_ID))
			.limit(1)
	).at(0);

/** Every funnel row written since the run started, newest last. */
const funnelSince = (since: number) =>
	db
		.select({
			flowId: schema.waitlistFunnelEvent.flowId,
			event: schema.waitlistFunnelEvent.event,
			createdAt: schema.waitlistFunnelEvent.createdAt
		})
		.from(schema.waitlistFunnelEvent)
		.where(gte(schema.waitlistFunnelEvent.createdAt, new Date(since)))
		.orderBy(schema.waitlistFunnelEvent.createdAt);

/**
 * Poll until `read` satisfies `done`, or give up.
 *
 * EVERY WRITE THIS SCRIPT ASSERTS ON IS FIRE-AND-FORGET. The funnel insert, the Priority-A claim and
 * the notification all run inside `ctx.waitUntil`, which by contract settles AFTER the response — so
 * reading the database the instant a POST returns is a race the script would lose intermittently, and
 * a smoke that fails one run in five is worse than no smoke. Polling is the honest shape for "this
 * happens, just not before the response".
 */
async function eventually<T>(
	label: string,
	read: () => Promise<T>,
	done: (value: T) => boolean,
	describe: (value: T) => string
): Promise<T> {
	const deadline = Date.now() + 10_000;
	let last = await read();
	while (!done(last) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		last = await read();
	}
	if (!done(last)) die(`${label}: ${describe(last)}`);
	return last;
}

/**
 * Wait for a LATER write to land, then hand back the reading — for assertions that something did NOT
 * happen.
 *
 * A NEGATIVE ASSERTION WITH NO WAIT IS VACUOUS, and this script shipped one before it shipped
 * anything else. An earlier cut reloaded /waitlist and immediately asserted "still one flow, still one
 * view". It passed. It was also wrong twice over: the reload was before step 1, so there was no resume
 * cookie and a second flow was CORRECT — and the row proving it arrived 235 ms after the read, so the
 * assertion would have passed against the broken case just as happily. That is DAR-81's pattern (a
 * guard that passes hardest when nothing has happened yet) in the one place a `waitUntil` makes it
 * easy to write by accident.
 *
 * A fixed sleep would fix the timing and nothing else — it encodes a duration measured on one machine.
 * `anchor` is a happens-AFTER instead: something the run does later, through the same request path into
 * the same database, whose arrival means the earlier write has had its chance. Ordering, not a clock.
 */
async function settled<T>(label: string, read: () => Promise<T>, anchor: (value: T) => boolean) {
	return eventually(label, read, anchor, () => `the anchor for this check never arrived`);
}

/** Remove everything this script's fixed lead id owns. Submissions explicitly, not by cascade. */
async function purgeLead(): Promise<void> {
	await db
		.delete(schema.waitlistSubmission)
		.where(eq(schema.waitlistSubmission.leadId, SMOKE_LEAD_ID));
	await db.delete(schema.waitlistLead).where(eq(schema.waitlistLead.id, SMOKE_LEAD_ID));
}

/** One error and every `cause` under it, flattened — libsql nests the server's real complaint. */
function withCauses(err: unknown, depth = 4): string {
	const parts: string[] = [];
	for (let current = err; current !== undefined && depth-- > 0;) {
		parts.push(String(current));
		current = current instanceof Error ? current.cause : undefined;
	}
	return parts.join(' | ');
}

const assertEqual = (label: string, actual: unknown, expected: unknown): void => {
	if (actual !== expected) {
		die(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
};

// ---------------------------------------------------------------------------------------------
// A. Clean slate. Runs BEFORE the flow, not only after it: a run that dies halfway leaves a lead and
//    its submissions in place, and the next run would then be walking a row that already holds every
//    answer — testing a different thing than it reports on.
// ---------------------------------------------------------------------------------------------
const runStart = await dbNow().catch((err: unknown) =>
	die(`could not reach the database in .env (${String(err)})`)
);

// Anything else holding this address is somebody else's row: refuse rather than delete it, and refuse
// rather than let the `lower(email)` unique index reject the seed below with a constraint error nobody
// can act on. This is the check that makes a typo in SMOKE_WAITLIST_EMAIL cost nothing.
const [foreignLead] = await db
	.select({ id: schema.waitlistLead.id })
	.from(schema.waitlistLead)
	.where(and(eq(lowerLeadEmail, smokeEmail), sql`${schema.waitlistLead.id} <> ${SMOKE_LEAD_ID}`))
	.limit(1);
if (foreignLead) {
	die(
		`${smokeEmail} is already on the waitlist (lead ${foreignLead.id}) and this script did not put it there. SMOKE_WAITLIST_EMAIL must be a throwaway address — refusing to touch a real signup.`
	);
}

await purgeLead();
// Seeded so that `isNew` is false for every submission below and no mail leaves — see the header.
//
// This is also the FIRST write of the run, and therefore where a database behind the schema announces
// itself. Worth naming, because the symptom otherwise arrives much later and much less legibly: the
// signup POST answers a bare 500 whose only detail is in the preview's own log, since drizzle names
// every column the schema declares whether or not the table has it.
await db
	.insert(schema.waitlistLead)
	.values({ id: SMOKE_LEAD_ID, email: smokeEmail })
	.catch((err: unknown) => {
		// The reason is in the CAUSE, not in the message: drizzle's own error says only "Failed query"
		// plus the SQL, and libsql nests the server's "no column named …" underneath. Reading just the
		// top would print the least useful half of what arrived.
		const hint = /no column named/.test(withCauses(err))
			? ' — the database in .env is behind the schema; run `pnpm db:push`'
			: '';
		die(`could not seed the lead${hint} (${String(err)})`);
	});
ok(`seeded lead ${SMOKE_LEAD_ID} for ${smokeEmail} (so no signup mail is sent)`);

// ---------------------------------------------------------------------------------------------
// B. Arrive. The page's load is the funnel's ONLY minter (DAR-86), so this GET is what buys the flow
//    every event below is recorded under.
// ---------------------------------------------------------------------------------------------
const arrival = await visit().catch((err: unknown) =>
	die(`could not reach ${BASE} — is \`pnpm build && pnpm preview\` running? (${String(err)})`)
);
const step1Action = expectStep(arrival, 'joinWaitlist', 'arrival');
const flowHandle = hidden(arrival, 'flowId');
if (!flowHandle) {
	die(
		'arrival: the signup form carries no flow handle — is BETTER_AUTH_SECRET set in the .env wrangler loaded?'
	);
}
ok('/waitlist renders the signup form and mints a funnel handle');

// ---------------------------------------------------------------------------------------------
// C. That view reached the database, under exactly one flow. Everything after this is anchored to the
//    flow id learned here — which is also the whole reason the run must be the only thing driving
//    /waitlist against this database.
// ---------------------------------------------------------------------------------------------
const firstRows = await eventually(
	'view event',
	() => funnelSince(runStart),
	(rows) => rows.some((row) => row.event === 'waitlist_viewed'),
	(rows) =>
		`no waitlist_viewed row appeared (saw ${rows.length} funnel rows since the run started) — the load's capture is fire-and-forget, so this means it failed or the worker is on another database`
);
const flowIds = [...new Set(firstRows.map((row) => row.flowId))];
if (flowIds.length !== 1) {
	die(
		`view event: ${flowIds.length} distinct flows have written rows since this run started — something else is driving /waitlist against this database, so the funnel assertions below cannot mean anything`
	);
}
const FLOW_ID = flowIds[0];
ok(`the page view recorded waitlist_viewed under one flow (${FLOW_ID})`);

// ---------------------------------------------------------------------------------------------
// D. Step 1. The submission is APPENDED under the seeded lead (DAR-88) — it does not create a second
//    lead for the same address, and it does not edit the lead's own columns.
// ---------------------------------------------------------------------------------------------
const step2Page = await submit(step1Action, {
	name: STEP1.name,
	email: smokeEmail,
	company: STEP1.company,
	countryRegion: STEP1.countryRegion,
	'b:consentUpdates': 'on',
	website: '', // the honeypot, left empty: this is a real signup, not the e2e's decoy path
	flowId: flowHandle
});
const step2Action = expectStep(step2Page, 'submitWaitlistStep2', 'step 1');
const token = requiredHidden(step2Page, 'token', 'step 1');

const afterSignup = await submissionsForLead();
assertEqual('step 1', afterSignup.length, 1);
const [first] = afterSignup;
assertEqual('step 1', first.email, smokeEmail);
assertEqual('step 1', first.name, STEP1.name);
assertEqual('step 1', first.company, STEP1.company);
assertEqual('step 1', first.countryRegion, STEP1.countryRegion);
assertEqual('step 1', first.consentUpdates, true);
if (!first.consentUpdatesAt) die('step 1: consent was recorded without its provenance timestamp');
assertEqual('step 1', first.qualificationStep, 1);
if (!first.ipHash) die('step 1: the submission carries no hashed IP — the throttle cannot see it');
/** The row every assertion below is about — see step L for why it is remembered rather than sorted to. */
const firstSubmissionId = first.id;
ok(
	'step 1 appended a submission under the existing lead, with step-1 columns and consent provenance'
);

// D2. The ticked box asked this address to confirm (DAR-139), and the timestamp is READ HERE rather
//     than in step N with the rest of the gate. The reason is what makes step O's "nobody re-asked"
//     mean anything: step L signs up again with the box ticked, so a timestamp sampled after it could
//     be a RE-stamp, and comparing that to itself at the end of the run would pass against a claim
//     that had lost its 24h predicate entirely — the vacuous-negative shape this file's header warns
//     about. Observing before the second signup EXISTS removes the question instead of asserting an
//     answer to it; an earlier cut compared this against the second submission's `created_at`, which
//     was a real check and also a flake waiting for one slow `ctx.waitUntil` to misreport as "the
//     second ticked box re-asked".
//
//     Fire-and-forget (the claim AND the send run inside ctx.waitUntil), so it polls rather than
//     reading once.
const askedLead = await eventually(
	'updates ask',
	leadRow,
	(row) => row?.updatesConfirmSentAt != null,
	() =>
		'updates_confirm_sent_at was never stamped — the claim is fire-and-forget, so this means it failed, RESEND_API_KEY/ORIGIN are unset, or the worker is on another database'
);
const askedAt = askedLead!.updatesConfirmSentAt!.getTime();
assertEqual('updates ask', waitlistUpdatesState(askedLead!), 'asked');
// Asking is not permission. Asserted at the moment of asking, which is the moment it would be
// tempting to treat a ticked box as consent.
assertEqual('updates ask', mayReceiveUpdates(askedLead!), false);
ok('a ticked box asked this address to confirm — and asking is not yet permission to send');

// THE FORGED-FLOW PROBE (DAR-86), fired here rather than later so the honest step 2 below can be its
// anchor — see `settled`. This is the threat the ticket names literally: before DAR-86 the step
// endpoints reached the funnel insert with NO continuation token at all, so a bare POST carrying a
// self-chosen UUID wrote analytics rows for free and a fresh id per POST defeated the composite key
// outright. So the probe carries no cookie, no token and an id it made up, and must record NOTHING.
//
// A bare UUID rather than junk on purpose: it is the COLUMN's own shape, so only the signature can
// tell it apart. Junk would also be rejected by the shape check, which would make the probe pass for
// the wrong reason.
const forgedFlowId = randomUUID();
const forged = await submit(
	step2Action,
	{ flowId: forgedFlowId, intent: 'skip' },
	{ anonymous: true }
);
if (forged.status !== 200) die(`forged flow: expected 200, got ${forged.status}`);
const forgedRows = async () =>
	db
		.select({ event: schema.waitlistFunnelEvent.event })
		.from(schema.waitlistFunnelEvent)
		.where(eq(schema.waitlistFunnelEvent.flowId, forgedFlowId));

// ---------------------------------------------------------------------------------------------
// E. Reload MID-FLOW. Two properties at once, and the "mid-flow" is load-bearing for the second.
//
//    The cookie carries the row id, and the load re-mints a continuation token from it rather than
//    storing one (DAR-75) — so a token this script never saw before now authorizes the same row. That
//    round trip is only possible if the load and the step endpoints resolve the same signing secret
//    (DAR-99), which is the composition no spec in the repo can reach.
//
//    And it keeps the visitor on ONE flow, which is the half of DAR-75 that fixed the `__data.json`
//    view over-count. THIS IS ONLY TRUE ONCE A RESUME COOKIE EXISTS: reloading before signing up is
//    two fresh arrivals, so it correctly mints two flows and records two views — the floor DAR-66
//    accepted. An earlier cut of this script asserted "a reload keeps the flow" BEFORE step 1 and
//    passed anyway, which is the finding worth keeping (see the note above `settled`).
// ---------------------------------------------------------------------------------------------
if (!jar.has(WAITLIST_RESUME_COOKIE)) die('step 1: no resume cookie was set');
const resumed = await visit();
expectStep(resumed, 'submitWaitlistStep2', 'resume');
const resumedToken = requiredHidden(resumed, 'token', 'resume');
ok('a reload resumes at step 2 with a freshly minted token');

// ---------------------------------------------------------------------------------------------
// F. Step 2, submitted with the RESUMED token — so the assertion below is that a token minted by the
//    page's load authorized a write at a step endpoint. A commercial use case routes to step 3, which
//    is a server decision (waitlist-flow.ts) the page only obeys.
// ---------------------------------------------------------------------------------------------
const step3Page = await submit(step2Action, {
	token: resumedToken,
	flowId: requiredHidden(resumed, 'flowId', 'resume'),
	intent: 'continue',
	...STEP2
});
const step3Action = expectStep(step3Page, 'submitWaitlistStep3', 'step 2');
const flowClaim = requiredHidden(step3Page, 'flowClaim', 'step 2');

const [afterStep2] = await submissionsForLead();
assertEqual('step 2', afterStep2.role, STEP2.role);
assertEqual('step 2', afterStep2.primaryApplication, STEP2.primaryApplication);
assertEqual('step 2', afterStep2.evaluationTimeline, STEP2.evaluationTimeline);
assertEqual('step 2', afterStep2.qualificationStep, 2);
assertEqual('step 2', afterStep2.stepWriteCount, 1);
ok('step 2 enriched the token’s own submission and routed to step 3');

// The two negative claims made before this step, now settled. `use_case_completed` is the anchor: it
// was issued by the step-2 POST above, AFTER the reload and after the forged probe, through the same
// request path into the same database — so its arrival means both of theirs have had their chance.
// Ordering, not a clock (see `settled`).
const afterReload = await settled(
	'reload',
	() => funnelSince(runStart),
	(rows) => rows.some((row) => row.event === 'use_case_completed')
);
// The forged flow FIRST, and the order is not cosmetic: its rows would land inside the run's own
// window, so the one-flow check below sees them too and reports "expected 1, got 2" about the reload.
// Both catch it; only this one names it.
assertEqual('forged flow', (await forgedRows()).length, 0);
ok('a self-chosen flow id records nothing — a funnel row still costs a page view');

assertEqual('reload', new Set(afterReload.map((row) => row.flowId)).size, 1);
assertEqual('reload', afterReload.filter((row) => row.event === 'waitlist_viewed').length, 1);
ok('a mid-flow reload stays on one flow and re-records no view');

// ---------------------------------------------------------------------------------------------
// G. Step 3. Its answers are the money questions, which is why branch A is reached at all — and the
//    branch itself comes from step 2's SIGNED claim rather than from a re-read of the row (DAR-63's
//    anti-oracle rule), so this also proves the claim survives a round trip through the browser.
// ---------------------------------------------------------------------------------------------
const step4Page = await submit(step3Action, {
	token: requiredHidden(step3Page, 'token', 'step 2'),
	flowClaim,
	flowId: requiredHidden(step3Page, 'flowId', 'step 2'),
	intent: 'continue',
	currentApproach: STEP3.currentApproach,
	economicImpact: STEP3.economicImpact,
	budgetRange: STEP3.budgetRange,
	'adoptionEvidence[]': [...STEP3.adoptionEvidence]
});
const step4aAction = expectStep(step4Page, 'submitWaitlistStep4A', 'step 3');

const [afterStep3] = await submissionsForLead();
assertEqual('step 3', afterStep3.currentApproach, STEP3.currentApproach);
assertEqual('step 3', afterStep3.economicImpact, STEP3.economicImpact);
assertEqual('step 3', afterStep3.budgetRange, STEP3.budgetRange);
assertEqual(
	'step 3',
	JSON.stringify(afterStep3.adoptionEvidence),
	JSON.stringify(STEP3.adoptionEvidence)
);
assertEqual('step 3', afterStep3.qualificationStep, 3);
assertEqual('step 3', afterStep3.stepWriteCount, 2);
// Step 2's answers are still there. `coalesce(new, existing)` is the ONE write rule left after DAR-88,
// and a step that quietly cleared the columns it doesn't ask about would look identical from outside.
assertEqual('step 3', afterStep3.role, STEP2.role);
assertEqual('step 3', afterStep3.evaluationTimeline, STEP2.evaluationTimeline);
ok('step 3 enriched the same row, kept step 2’s answers, and forked to branch A');

// ---------------------------------------------------------------------------------------------
// H. Step 4A, the terminal step. `contact_permission` is the tri-state: a grant may only be recorded
//    from a question that was actually on screen, which the validator decides independently from the
//    pilot answer — so a `true` here is evidence of that gate agreeing with the render.
// ---------------------------------------------------------------------------------------------
const donePage = await submit(step4aAction, {
	token: requiredHidden(step4Page, 'token', 'step 3'),
	flowClaim: requiredHidden(step4Page, 'flowClaim', 'step 3'),
	flowId: requiredHidden(step4Page, 'flowId', 'step 3'),
	intent: 'continue',
	pilotInterest: STEP4A.pilotInterest,
	loiReadiness: STEP4A.loiReadiness,
	deploymentScale: STEP4A.deploymentScale,
	'b:contactPermission': 'on',
	contactMethod: STEP4A.contactMethod,
	phone: STEP4A.phone
});
if (donePage.status !== 200) die(`step 4A: expected 200, got ${donePage.status}`);
if (stepAction(donePage, 'submitWaitlistStep4A')) {
	die('step 4A: the flow did not terminate — the step-4A form is still on the page');
}
// DAR-64: the confirmation is one CTA and nothing else. A positive pilot answer earns the /contact one.
if (!donePage.html.includes('Request an evaluation conversation')) {
	die('step 4A: the confirmation did not offer the pilot CTA a positive pilot answer earns');
}
// …and it is a real anchor, which JS upgrades into the modal rather than replaces.
if (!donePage.html.includes('href="/contact"')) {
	die('step 4A: the pilot CTA is not a real /contact link');
}
// The internal-only answers must have no path to this screen (DAR-64). Asserted against the actual
// value this run submitted rather than against a label, because the free text is the one that would
// hurt most and the one a summary would most plausibly include.
if (donePage.html.includes(STEP4A.deploymentScale)) {
	die('step 4A: the confirmation echoed the internal-only deployment-scale answer');
}

const [afterStep4a] = await submissionsForLead();
assertEqual('step 4A', afterStep4a.pilotInterest, STEP4A.pilotInterest);
// DAR-112. The only end-to-end proof this column has: the hermetic e2e reaches step 4A on a DECOY
// token and writes nothing, and the unit specs hand the validator an object literal — so the hop from
// the form's field NAME through form-data to `data.loiReadiness` is exercised nowhere else. A typo on
// either side of it would drop the answer silently, which is the failure this line exists to catch.
assertEqual('step 4A', afterStep4a.loiReadiness, STEP4A.loiReadiness);
assertEqual('step 4A', afterStep4a.deploymentScale, STEP4A.deploymentScale);
assertEqual('step 4A', afterStep4a.contactPermission, true);
assertEqual('step 4A', afterStep4a.contactMethod, STEP4A.contactMethod);
assertEqual('step 4A', afterStep4a.phone, STEP4A.phone);
assertEqual('step 4A', afterStep4a.qualificationStep, 4);
assertEqual('step 4A', afterStep4a.stepWriteCount, 3);
ok('step 4A wrote the branch-A columns and terminated on the pilot CTA');

// ---------------------------------------------------------------------------------------------
// I. What the flow adds up to. The classifier is computed on READ from these columns (DAR-65), so this
//    is the first time it has ever been handed a row that a real walk through the form produced.
// ---------------------------------------------------------------------------------------------
assertEqual('classification', classifyWaitlistLead(afterStep4a), 'priority-a');
ok('the walked row classifies Priority A');

// DAR-82's claim. Fire-and-forget inside `ctx.waitUntil`, hence the poll.
const claimed = await eventually(
	'priority-A claim',
	leadRow,
	(lead) => Boolean(lead?.priorityANotifiedAt),
	() =>
		'priority_a_notified_at was never stamped — the step write reached the classifier but not the claim (is RESEND_API_KEY set in the .env wrangler loaded? the key is checked BEFORE the claim)'
);
const claimedAt = claimed?.priorityANotifiedAt?.getTime();
ok(`the Priority-A notification was claimed once (and one email went to info@)`);

// ---------------------------------------------------------------------------------------------
// J. …and only once, ever. A walk-back re-submits step 4A on the same row; it classifies Priority A
//    again, reaches the claim again, and the conditional UPDATE must match nothing. This is the half
//    that stops a lead being announced on every step they ever submit.
// ---------------------------------------------------------------------------------------------
const walkedBack = await submit(step4aAction, {
	token,
	flowClaim: requiredHidden(step4Page, 'flowClaim', 'walk-back'),
	flowId: flowHandle,
	intent: 'continue',
	pilotInterest: STEP4A.pilotInterest
});
if (walkedBack.status !== 200) die(`walk-back: expected 200, got ${walkedBack.status}`);
const [afterWalkBack] = await submissionsForLead();
// One more than step 4A's, whatever that was. Derived rather than written down: a hard-coded 4 is true
// only for exactly this sequence of steps, and the next ticket to insert one would get a budget
// failure pointing at the budget.
assertEqual('walk-back', afterWalkBack.stepWriteCount, (afterStep4a.stepWriteCount ?? 0) + 1);
// Read here and AGAIN at the end of the run (step O). The late read is the load-bearing one: the claim
// runs inside `ctx.waitUntil`, so this one can only catch a re-claim fast enough to have already
// landed. A second claim would move the timestamp permanently, so a later look needs no sleep — by
// then the run has spent seventeen more round trips.
assertEqual('walk-back', (await leadRow())?.priorityANotifiedAt?.getTime(), claimedAt);
ok('a second Priority-A-classifying write claims nothing (at most once, ever)');

// ---------------------------------------------------------------------------------------------
// K. The per-row step-write budget (DAR-68). Spend the window down to the cap and then over it. The
//    refusal is SILENT by design — a refused step, a decoy token, an expired token and a deleted row
//    are one generic success — so the only way to see it is in the columns.
// ---------------------------------------------------------------------------------------------
// Read from the row rather than counted up from the steps above. The same rot argument as the
// walk-back's: a hard-coded "4" would send this loop over or under the cap the moment a step is added
// or removed, and the failure would name the budget rather than the arithmetic.
const spent = afterWalkBack.stepWriteCount ?? 0;
for (let i = spent; i < WAITLIST_STEP_WRITE_MAX; i++) {
	const res = await submit(step2Action, {
		token,
		flowId: flowHandle,
		intent: 'continue',
		role: STEP2.role
	});
	if (res.status !== 200) die(`budget: write ${i + 1} answered ${res.status}`);
}
const atCap = (await submissionsForLead())[0];
assertEqual('budget', atCap.stepWriteCount, WAITLIST_STEP_WRITE_MAX);

const refused = await submit(step2Action, {
	token,
	flowId: flowHandle,
	intent: 'continue',
	role: REFUSED_ROLE
});
// The response is the reason this needs a database at all: it is a normal 200 that routes onward,
// exactly like the twenty permitted writes before it.
expectStep(refused, 'submitWaitlistStep3', 'budget');
const overCap = (await submissionsForLead())[0];
assertEqual('budget', overCap.role, STEP2.role); // the refused write's answer did NOT land
assertEqual('budget', overCap.stepWriteCount, WAITLIST_STEP_WRITE_MAX); // …and cost no budget
assertEqual(
	'budget',
	overCap.stepWriteWindowAt?.getTime(),
	atCap.stepWriteWindowAt?.getTime() // a fixed window: hammering cannot extend its own lockout
);
ok(
	`the ${WAITLIST_STEP_WRITE_MAX}th write is the last — the next is refused silently and costs nothing`
);

// ---------------------------------------------------------------------------------------------
// L. Append-only (DAR-88). The same address again: a NEW submission under the SAME lead, with the
//    first one's answers untouched. This is the property that dissolved every per-column write policy
//    the module used to carry, and the only place it is observed against a real insert.
//
//    POSTED WITHOUT A FRESH GET, and that is deliberate rather than a shortcut. The run's resume cookie
//    now says `done`, so a GET would render the CONFIRMATION — the visitor would have to press "Start a
//    new signup" first, which 303s to a bare path and therefore mints a SECOND flow (DAR-75 says so:
//    a restarted visitor is a new arrival). That would break step M's "one visitor, one flow" claim for
//    no gain here, and the restart itself is thoroughly covered by the hermetic e2e, which can drive it
//    through a real browser. What this step is about is the INSERT.
// ---------------------------------------------------------------------------------------------
const secondSignup = await submit(step1Action, {
	name: 'Mallory Smoke', // a different name, which under append-only is a second claim, not an edit
	email: smokeEmail,
	// Ticked here as well as at step 1, which is neutral for THIS step and is what gives step N
	// something to observe: DAR-139's per-lead window has to refuse the second ask.
	'b:consentUpdates': 'on',
	website: '',
	flowId: flowHandle
});
expectStep(secondSignup, 'submitWaitlistStep2', 'second signup');

const bothSubmissions = await submissionsForLead();
assertEqual('append-only', bothSubmissions.length, 2);
const [original, appended] = bothSubmissions;
// Keyed on the id captured at step E, not on the sort: "the older row" and "the row every assertion
// above was about" have to be the same row, or the two checks below would pass on each other.
assertEqual('append-only', original.id, firstSubmissionId);
assertEqual('append-only', appended.name, 'Mallory Smoke');
assertEqual('append-only', original.name, STEP1.name); // untouched
assertEqual('append-only', original.pilotInterest, STEP4A.pilotInterest); // …answers and all
assertEqual('append-only', appended.pilotInterest, null); // the new row starts empty
assertEqual('append-only', appended.qualificationStep, 1);
assertEqual(
	'append-only',
	(await db.select().from(schema.waitlistLead).where(eq(lowerLeadEmail, smokeEmail))).length,
	1
);
ok('a repeat email appended a second submission under one lead, editing nothing');

// The lead's band is the strongest ANY SINGLE submission earned — never a merge, which could assemble
// a Priority A out of answers no one person gave (DAR-88).
assertEqual('classification', classifyWaitlistLead(appended), 'research');
assertEqual('classification', classifyWaitlistLeadGroup(bothSubmissions), 'priority-a');
ok('the lead classifies on its strongest single submission, not on a merge');

// ---------------------------------------------------------------------------------------------
// M. The funnel, whole. Twenty-odd step POSTs went through the endpoints above; the composite primary
//    key means each event is one row per flow regardless (DAR-66), which is what makes
//    `waitlist_signup_completed / waitlist_viewed` a conversion rate rather than a ratio of retries.
//
//    WHY THIS NEEDS NO ANCHOR OF ITS OWN, which is worth stating because the check below LOOKS like one
//    and is not: `qualification_completed` was recorded back at step H, so this `eventually` returns on
//    its first read. The set is CLOSED by then, for two separate reasons —
//
//      * no new FLOW can appear: only a GET mints one that records anything (`waitlist_viewed` is
//        GET-only, DAR-66), and this run's last GET was step E. Every POST after it carries the handle
//        step B was given.
//      * no new EVENT can appear: `qualification_completed` is the last one a server-side path can
//        produce, and step H fired it. Steps J–L replay events already recorded, which the composite
//        key turns into no-ops — that being the property under test. (The one remaining slug,
//        `evaluation_conversation_requested`, is the client-fired command this script leaves alone.)
//
//    So the honest anchor for the whole set is the one that covered its last new member, and the
//    earlier `settled` covered the flow count. If a later ticket adds a step that emits something new,
//    this needs a real anchor again.
// ---------------------------------------------------------------------------------------------
const finalRows = await eventually(
	'funnel',
	() => funnelSince(runStart),
	(rows) => rows.some((row) => row.event === 'qualification_completed'),
	() => 'qualification_completed never arrived — the terminal step recorded nothing'
);
const stillOneFlow = [...new Set(finalRows.map((row) => row.flowId))];
assertEqual('funnel', stillOneFlow.length, 1);
assertEqual('funnel', stillOneFlow[0], FLOW_ID);

// Exactly the events this walk should have produced, and each exactly once.
const EXPECTED_EVENTS = [
	'waitlist_viewed',
	'waitlist_signup_completed',
	'qualification_started',
	'use_case_completed',
	'commercial_context_completed',
	'pilot_interest_selected',
	'qualification_completed'
];
const recorded = finalRows.map((row) => row.event).sort();
assertEqual('funnel', JSON.stringify(recorded), JSON.stringify([...EXPECTED_EVENTS].sort()));
ok(`the whole walk recorded ${EXPECTED_EVENTS.length} events, one row each, under one flow`);

// ---------------------------------------------------------------------------------------------
// N. The updates sending gate (DAR-139), end to end against a real database.
//
//    THE COMPOSITION NEITHER SUITE REACHES, for the same reasons as everything else in this file. The
//    unit specs round-trip mint → verify inside one module with the secret handed in; the e2e keeps every
//    token it sends deliberately unsignable, because a test that minted one from a local `.env` would
//    assert something different in CI than on a developer's machine (DAR-79/DAR-81), so the confirmed
//    path is unreachable there by construction rather than by accident of environment. What is only
//    observable here is the join: a token the MAILER minted
//    being accepted by the ROUTE, against the running worker's own resolution of the signing secret
//    (DAR-99's whole concern), and the conditional UPDATE behind it landing on a real row.
//
//    THE ASK ITSELF IS OBSERVED BACK AT STEP D2, not here — see the note there for why the timestamp
//    has to be sampled before step L ticks the box a second time. This block picks up from the click.
//
//    IT MINTS, AND DELIBERATELY DOES NOT PARSE. The rule this script follows elsewhere is that a client
//    which can take a signed value apart will eventually be tempted to put one together — so the funnel
//    is anchored by the database's clock rather than by splitting the handle. Minting is the other
//    direction and is allowed here under a narrower rule: the script may CALL the same exported
//    function the server calls, and may not reimplement or decompose the format. That is what makes
//    this a test of agreement rather than a second implementation to keep in sync.
// ---------------------------------------------------------------------------------------------
const signingSecret = process.env.BETTER_AUTH_SECRET as WaitlistSigningSecret | undefined;
if (!signingSecret) {
	die(
		'BETTER_AUTH_SECRET is not set (check .env) — the updates links cannot be minted without it.'
	);
}

// N1. The confirmation itself. The token is minted with the same function the email uses and the same
//     secret the worker loaded, so a POST it accepts is the two ends agreeing across a real request.
const confirmed = await updatesPost(
	UPDATES_CONFIRM_PATH,
	await mintUpdatesConfirmToken(signingSecret, SMOKE_LEAD_ID)
);
if (!/works without signing in/i.test(confirmed.html)) {
	die(`updates confirm: the page did not report a confirmation (status ${confirmed.status})`);
}
const confirmedLead = (await leadRow())!;
assertEqual('updates confirm', waitlistUpdatesState(confirmedLead), 'confirmed');
assertEqual('updates confirm', mayReceiveUpdates(confirmedLead), true);
// …and the address is now IN the audience, which is the query a future sender would read. Two
// encodings of one rule (waitlist-store.spec.ts pins them against each other); this is the only place
// the SQL half runs against a row that arrived through the real flow.
const audience = await readUpdatesAudience(appDb);
if (!audience.some((row) => row.id === SMOKE_LEAD_ID)) {
	die('updates confirm: the confirmed address is not in readUpdatesAudience');
}
ok('the emailed link confirmed the address, and it is in the audience a sender may read');

// N2. The login-free withdrawal /privacy promises. No session, no account — the token is the whole
//     authorization.
const unsubscribed = await updatesPost(
	UPDATES_UNSUBSCRIBE_PATH,
	await mintUpdatesUnsubscribeToken(signingSecret, SMOKE_LEAD_ID)
);
if (!/place on the early-access waitlist is unaffected/i.test(unsubscribed.html)) {
	die(`updates unsubscribe: the page did not report a withdrawal (status ${unsubscribed.status})`);
}
const withdrawnLead = (await leadRow())!;
assertEqual('updates unsubscribe', waitlistUpdatesState(withdrawnLead), 'unsubscribed');
assertEqual('updates unsubscribe', mayReceiveUpdates(withdrawnLead), false);
// The confirmation timestamp SURVIVES the withdrawal — it is the record of what happened, and the
// state already excludes them (schema.ts says so). A cleared column here would be evidence destroyed.
if (withdrawnLead.updatesConfirmedAt == null) {
	die('updates unsubscribe: the confirmation timestamp was cleared — that is the audit trail');
}
if ((await readUpdatesAudience(appDb)).some((row) => row.id === SMOKE_LEAD_ID)) {
	die('updates unsubscribe: a withdrawn address is still in the audience');
}
ok('the login-free link withdrew the address, keeping the confirmation as the audit trail');

// N3. And the form cannot bring them back. The tick box is the one surface a stranger controls, so a
//     re-tick after a withdrawal must not restart the asks — otherwise unsubscribing stops one message
//     instead of the relationship. Whether the claim was refused is checked in step O: it is a
//     fire-and-forget write, so "it did not happen" needs a happens-after, and the rest of the run is
//     the wait.
await submit(step1Action, {
	name: 'Mallory Smoke',
	email: smokeEmail,
	'b:consentUpdates': 'on',
	website: '',
	flowId: flowHandle
});
ok('a fresh signup ticked the box again after the withdrawal (the refusal is asserted at the end)');

// ---------------------------------------------------------------------------------------------
// O. The two "this did NOT happen" claims, re-read now that the run has moved well past them.
//
//    The forged-flow probe already has a happens-after anchor of its own (step F). This is the second
//    look, and it is what covers the Priority-A claim, whose only earlier read was immediate and
//    therefore racing a `ctx.waitUntil`. A late read needs no clock: everything the run did afterwards
//    is the wait. Both are re-read together because the cost is two queries.
// ---------------------------------------------------------------------------------------------
const finalLead = await leadRow();
assertEqual('claimed once', finalLead?.priorityANotifiedAt?.getTime(), claimedAt);
assertEqual('forged flow', (await forgedRows()).length, 0);
// DAR-139's two refusals, both of them fire-and-forget writes that were supposed NOT to happen — so
// they are read here, where everything the run did afterwards is the wait, rather than immediately
// after the submits that could have made them.
//
// One timestamp covers both, and only because step D2 pinned it to step 1's ask rather than to whatever
// the column happened to hold: `updates_confirm_sent_at` is still that value, so neither the second
// signup (asked inside the 24h window) nor the fourth (asked after a withdrawal) re-stamped it. A
// refused ask leaves the column alone, so hammering cannot walk the window forward.
assertEqual('updates ask window', finalLead?.updatesConfirmSentAt?.getTime(), askedAt);
assertEqual('updates withdrawal', waitlistUpdatesState(finalLead!), 'unsubscribed');
ok('nothing drifted afterwards: one claim, no forged rows, one ask, still withdrawn');

// ---------------------------------------------------------------------------------------------
// P. Tear down. Only what this run created.
//
//    The funnel rows are deleted by the flow id learned in step C. A run that dies BEFORE that point
//    can leave rows behind that nothing can key on afterwards — they carry no lead, no address and no
//    marker, which is the anonymity DAR-66 built in on purpose. They are harmless (every query here is
//    anchored to the run's own start), so the honest thing is to say so rather than to add a column
//    that would make them findable.
// ---------------------------------------------------------------------------------------------
await purgeLead();
await db.delete(schema.waitlistFunnelEvent).where(eq(schema.waitlistFunnelEvent.flowId, FLOW_ID));

if ((await submissionsForLead()).length !== 0) die('cleanup: submissions are still present');
if (await leadRow()) die('cleanup: the seeded lead is still present');
if ((await funnelSince(runStart)).length !== 0) die('cleanup: funnel rows are still present');
ok('cleaned up the seeded lead, its submissions, and this run’s funnel rows');

console.log('\n✓ waitlist flow smoke test passed');
