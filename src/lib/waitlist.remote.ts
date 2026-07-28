// The /waitlist page's two non-step remote `form` functions — the signup itself, and the restart that
// throws its resume state away. Both are spread onto a <form>, so both progressively enhance with JS
// and degrade to a native POST without. Lives in $lib (allowed); remote functions may sit anywhere
// under src EXCEPT $lib/server. `joinWaitlist` mirrors submitContact (contact.remote.ts); the key
// differences are the append-only submission insert (waitlist-store.ts) and gating the notification
// emails on a genuine new signup.
import { form, getRequestEvent } from '$app/server';
import { invalid, redirect } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { waitlistSubmission } from '$lib/server/db/schema';
import { validateWaitlist } from '$lib/server/waitlist';
import { insertWaitlistSubmission } from '$lib/server/waitlist-store';
import { mintWaitlistToken, decoyWaitlistId } from '$lib/server/waitlist-token';
import { clearWaitlistResume, setWaitlistResume } from '$lib/server/waitlist-resume';
import { waitlistSigningSecret } from '$lib/server/waitlist-secret';
import { hashIp } from '$lib/server/contact'; // shared truncated-SHA-256 IP hash (same throttle model)
import { sendWaitlistEmails } from '$lib/server/waitlist-notify';
import { captureWaitlistFunnel, resolveWaitlistFlowId } from '$lib/server/waitlist-funnel';
import { echoFlowId } from '$lib/waitlist-funnel';
import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime';

// Abuse throttle: at most THROTTLE_MAX signups per hashed IP per window (same as the contact form).
const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MAX = 5;

type WaitlistInput = {
	email: string;
	name: string;
	company: string;
	role: string;
	companySize: string;
	interest: string;
	hearAbout: string;
	phone: string;
	countryRegion: string; // v2 step 1 (DAR-60 renders it; validated slug)
	consentUpdates: boolean; // v2 step 1 marketing opt-in checkbox (typed boolean so DAR-60 can use .as('checkbox'))
	website: string; // honeypot — must stay empty
	flowId: string; // signed funnel handle minted by the page's load (DAR-66/86); anonymous, not stored on the row
};

// `token` is the signed continuation handle for the optional qualification steps (DAR-59): the
// step forms post it back and the server verifies (waitlist-token.ts) before enriching the row.
//
// ANTI-ENUMERATION, AND WHY IT IS NOW FREE (DAR-88): the same success shape — token included — is
// returned whether or not this address was already on the list, which is what keeps this from being an
// email-enumeration oracle. It used to be hiding a real difference, and the price of hiding it was
// that anyone who submitted a known address received a token bound to the FIRST submitter's row —
// every per-column write policy in waitlist-store.ts existed to contain that. Signups are append-only
// now, so there is no difference left to hide: each submit inserts its own row and the token binds to
// THAT one. A stranger who guesses a known address gets a token for their own submission and can never
// reach the real person's answers. The embedded row id is an opaque UUID and authorizes nothing
// without the MAC.
//
// `flowId` is echoed for the same reason `token` is: without JS this response IS a page re-render, and
// the load that runs alongside it mints a NEW handle. Reflecting the submitted one back lets step 2's
// hidden field keep the visitor on ONE funnel flow across native per-step POSTs. It's the caller's own
// value, reflected verbatim and never re-minted (DAR-86 makes the load the only minter), so this hands
// out nothing they didn't already have.
type WaitlistResult = { success: true; token?: string; flowId: string };

export const joinWaitlist = form<WaitlistInput, WaitlistResult>(
	'unchecked',
	async (data, issue) => {
		// Grab request-scoped handles FIRST (before any await): on workerd platform.env is only valid
		// during the request and getRequestEvent() must precede the first await. getDb() reads it sync.
		const db = getDb();
		const event = getRequestEvent();
		const ip = event.getClientAddress();
		const userAgent = event.request.headers.get('user-agent') ?? null;
		const platform = event.platform;
		const cookies = event.cookies;
		const locale = getLocale();
		// The token signing secret, via the shared per-request resolver (sync — valid at this
		// pre-await point). Reused from Better Auth (domain-separated inside waitlist-token.ts) so no
		// new secret needs provisioning.
		const tokenSecret = waitlistSigningSecret();

		// Honeypot: humans never fill the hidden `website` field; bots do. Silently accept (don't
		// persist, don't reveal the trap) — including a DECOY token so the response BODY matches a real
		// success. The decoy is deterministic per email (a fresh id each submit would itself leak the
		// trap) and addresses no real row. Note this hides only the body: the honeypot returns before
		// the DB round-trips a real submit makes, so a timing side-channel remains.
		//
		// No funnel event either — a tripped honeypot is a bot, and counting it would corrupt the one
		// metric this measures. (The e2e drives the flow through this very path, which is a second
		// reason it must stay silent: the hermetic suite writes no analytics rows.)
		//
		// The resume cookie (DAR-75) is written here TOO, around the decoy id. Skipping it would make
		// the trap detectable from a response HEADER, which is a far louder tell than the timing
		// side-channel already accepted above — and it costs nothing, because a decoy id resumes into
		// a flow whose every step write no-ops exactly as it does today.
		if (typeof data.website === 'string' && data.website.trim() !== '') {
			const flowHandle = echoFlowId(data.flowId);
			if (!tokenSecret) return { success: true, flowId: flowHandle };

			const decoyId = await decoyWaitlistId(tokenSecret, String(data.email ?? ''));
			await setWaitlistResume(cookies, tokenSecret, {
				stage: 'step2',
				submissionId: decoyId,
				branch: null,
				audience: null,
				cta: null,
				// The cookie carries the bare id (DAR-86), so the trap pays for one more verification —
				// and has to, or a resumed decoy would land on a fresh flow and re-record a view.
				flowId: await resolveWaitlistFlowId(tokenSecret, data.flowId)
			});
			return {
				success: true,
				token: await mintWaitlistToken(tokenSecret, decoyId),
				flowId: flowHandle
			};
		}

		const { ok, cleaned, errors } = validateWaitlist(data);
		if (!ok) {
			const issues = [];
			if (errors.includes('name')) issues.push(issue.name(m.waitlist_error_name()));
			if (errors.includes('email')) issues.push(issue.email(m.waitlist_error_email()));
			invalid(...issues); // throws; fields.{name,email}.issues() populate client-side
		}

		// Light IP/time throttle (honeypot handles most bots; this caps floods). It counts SUBMISSIONS
		// created per hashed IP — which since DAR-88 means it finally sees repeat-email signups too: they
		// used to hide inside an UPDATE that added no row, so a same-address replay was throttle-exempt.
		// This is the bound on append-only's cost (a stranger burying a real signup under junk rows);
		// volumetric abuse from rotating IPs stays edge/WAF territory.
		const ipHash = await hashIp(ip);
		const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
		const recent = await db
			.select({ id: waitlistSubmission.id })
			.from(waitlistSubmission)
			.where(and(eq(waitlistSubmission.ipHash, ipHash), gt(waitlistSubmission.createdAt, since)));
		if (recent.length >= THROTTLE_MAX) invalid(m.waitlist_error_ratelimit());

		// Always inserts a submission; upserts the LEAD behind it. `isNew` is the lead insert winning,
		// i.e. a GENUINE first signup for this address — see waitlist-store.ts.
		const { isNew, id } = await insertWaitlistSubmission(db, cleaned, ipHash, userAgent);

		// Fire-and-forget notifications (lead + signer ack), same pattern as the contact form: the row
		// is already persisted, so a send failure must NOT fail the signup — log and move on.
		// ctx.waitUntil keeps the Worker alive until the sends resolve after the response; without a key
		// (unconfigured) or ctx (vite dev) we skip. Never awaited.
		//
		// Gated on `isNew`: a re-signup of an existing email must NOT re-mail. THIS IS THE MAILBOMB
		// GUARD, and append-only makes it more important rather than less — every submit now inserts, so
		// "it's a new row" is no longer any evidence that it's a new person. `isNew` is the LEAD insert
		// winning, which is the only thing that means "we have never mailed this address". Without it, a
		// script replaying one address would land an ack in that mailbox on every POST, plus a flood into
		// info@; the per-IP throttle bounds the rate but not the targeting.
		const resendKey = platform?.env?.RESEND_API_KEY;
		if (isNew && resendKey) {
			const send = sendWaitlistEmails(resendKey, cleaned, locale).catch((err) =>
				console.error('waitlist notifications failed', err)
			);
			if (platform?.ctx) platform.ctx.waitUntil(send);
		}

		// Funnel: the signup step completed (DAR-66). Fire-and-forget, and deliberately NOT gated on
		// `isNew` the way the emails above are — a returning visitor completed step 1 just the same,
		// and the metric this feeds ("of the people who saw the form, how many finished it") would be
		// wrong if it silently dropped them. It also keeps the two paths indistinguishable, which is
		// the same anti-enumeration reason the response shape is identical.
		// The submitted handle crosses to a vouched-for id here (DAR-86). This endpoint cannot mint one,
		// so a POST carrying a self-chosen UUID records no signup — and `waitlist_signup_completed`, the
		// numerator of the primary metric, is the event that most needed that.
		const flowId = await resolveWaitlistFlowId(tokenSecret, data.flowId);
		captureWaitlistFunnel(db, platform, flowId, ['waitlist_signup_completed']);

		// Remember where this browser got to, so a reload lands on step 2 rather than a blank form
		// (DAR-75). Written for new and existing emails alike, and on the honeypot path above — a
		// cookie that appeared only sometimes would be a response difference, which is the one thing
		// this endpoint is careful not to have. It carries only what we just handed back anyway.
		const flowHandle = echoFlowId(data.flowId);
		await setWaitlistResume(cookies, tokenSecret, {
			stage: 'step2',
			submissionId: id,
			branch: null, // step 2 hasn't been answered yet, so there is no branch or audience…
			audience: null,
			cta: null, // …and no terminal step has chosen a CTA.
			flowId
		});

		// New and existing emails get the same shape INCLUDING the token (anti-enumeration); without
		// a secret (misconfigured env) the signup still succeeds, just without the optional steps.
		return {
			success: true,
			token: tokenSecret ? await mintWaitlistToken(tokenSecret, id) : undefined,
			flowId: flowHandle
		};
	}
);

/**
 * Throw away this browser's resume state (DAR-75) — the "Start a new signup" escape hatch.
 *
 * WHY A FORM AND NOT A LINK. Resuming is what makes the escape hatch necessary, and clearing the
 * cookie is a state mutation, so it belongs behind a POST. The first cut was `<a href="?restart">`
 * handled in the page's load, and a destructive GET behind an internal link is a trap in a SvelteKit
 * app: `<body>` sets `preload-data="hover"`, so preloading the data ran the load and dropped the
 * cookie on mouse-over, with no click. That needed `data-sveltekit-reload` to defuse — a mitigation
 * for a hazard the method choice removes outright. A POST is never prefetched, so nothing can fire
 * this by accident.
 *
 * It also settles a design question the link raised: DAR-64 gives the confirmation exactly ONE call
 * to action, and a second <a> on that screen was at best a technicality. A submit button isn't a
 * link, so the rule holds without an argument.
 *
 * REDIRECTS RATHER THAN RETURNING. Classic POST/Redirect/GET, and here it buys something concrete
 * beyond a clean URL and no re-POST prompt: without JS the response to this POST is a page
 * RE-RENDER, and the funnel's view event is recorded on GET only (DAR-66's guard against counting
 * per-step POST re-renders). A restarted no-JS visitor would therefore begin a fresh flow whose
 * signup had no view behind it. The 303 turns the landing into a real GET, so the new flow is
 * counted exactly like any other arrival.
 *
 * Takes no input and needs no guard: it only deletes a cookie the caller already holds, so the worst
 * a forged POST does is show its own sender a signup form.
 */
export const restartWaitlist = form(async () => {
	const { cookies, url } = getRequestEvent();
	clearWaitlistResume(cookies);
	// `url` is the PAGE the form was called from (Kit's remote-function contract), so `pathname` keeps
	// whatever locale prefix it had — `/es/waitlist` restarts in Spanish — and drops the `?/remote=…`
	// a native submit posts to.
	redirect(303, url.pathname);
});
