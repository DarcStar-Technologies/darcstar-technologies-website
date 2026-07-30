// The confirmation request for product-and-research updates (DAR-139) — the one email that turns a
// ticked box into something we may act on, and the ONLY new send this ticket adds.
//
// WHY IT IS OPERATIONAL AND NOT MARKETING, which `email-senders.spec.ts` makes a declared act: it is
// sent because of a specific action taken about this address, it says only "did you ask for this?",
// and it carries no product or research content — the thing it asks permission for is precisely the
// thing it does not contain. Ship a version of this that markets, and the declaration in that spec
// becomes a lie a reviewer can see.
//
// ITS OWN MODULE rather than a third builder in waitlist-notify.ts, for DAR-82's reasons: those two
// messages fan out together from one signup and are a fixed part of it, while this one has a different
// trigger (a ticked box, on any submission), a different gate (a claim on the lead) and a different
// lifecycle ("at most once a day per address, and never once they have answered or withdrawn").
//
// TWO LINKS, and the second is not padding. /privacy promises an unsubscribe in every update, and this
// message is the first one an address can ever receive — the person most likely to want it is somebody
// whose address a stranger typed into the form, for whom "don't ask again" is the only useful control
// on the page. It is also what bounds the exposure the claim cannot: the window caps a stranger at one
// email a day, and this link ends it outright.
import type { Locale } from '$lib/paraglide/runtime';
import type { Db } from './db';
import type { WaitlistSigningSecret } from './waitlist-secret';
import { CONTACT_EMAIL, EMAIL_FROM } from '$lib/site';
import { m } from '$lib/paraglide/messages.js';
import { type OutboundEmail, escapeHtml, postEmail } from './email';
import { claimUpdatesConfirmSend } from './waitlist-store';
import { mintUpdatesConfirmToken, mintUpdatesUnsubscribeToken } from './waitlist-updates-token';

// Same verified role alias as the ack and the invitation (`EMAIL_FROM`, site.ts — six mailers were
// each building that string themselves), Reply-To the monitored info@ inbox, which matters here for
// the same reason it does on an invitation: an unexpected "did you ask for this?" is exactly the mail
// somebody wants to answer with a human question.
const FROM = EMAIL_FROM;

// RFC 3834 auto-reply headers, as on the waitlist ack: this is machine-generated and must not start a
// loop with an out-of-office responder.
const AUTO_REPLY_HEADERS: Record<string, string> = {
	'Auto-Submitted': 'auto-replied',
	'X-Auto-Response-Suppress': 'All'
};

export interface UpdatesConfirmEmailInput {
	/** The recipient — the address whose consent is being confirmed. */
	to: string;
	/** Absolute URL of the confirm landing page, carrying the `c1` token. */
	confirmUrl: string;
	/** Absolute URL of the unsubscribe landing page, carrying the `u1` token. */
	unsubscribeUrl: string;
}

/**
 * Render the confirmation request. Pure — unit-tested. Copy is Paraglide, resolved for `locale`; the
 * two URLs are HTML-escaped in the html body (they are ours, but a builder that escapes only some of
 * its inputs is one refactor from escaping none).
 *
 * NO NAME, AND NOT BECAUSE THE FIELD IS OPTIONAL. The waitlist's name is supplied by whoever filled in
 * the form, and this is the one message in the codebase whose whole premise is that the submitter and
 * the RECIPIENT may be different people — so greeting them by that name would let a stranger choose
 * how we address someone else in their own inbox. DAR-67 hit the same hazard on the invitation and
 * answered it by taking the earliest submission's name; here there is a better answer available,
 * because a message that says "someone asked us, was it you?" has no business claiming to know who it
 * is writing to. Escaping stops injection and does nothing about abuse by content.
 */
export function buildUpdatesConfirmEmail(
	input: UpdatesConfirmEmailInput,
	locale: Locale
): OutboundEmail {
	const o = { locale };
	const subject = m.waitlist_updates_confirm_email_subject({}, o);
	const body = m.waitlist_updates_confirm_email_body({}, o);
	const button = m.waitlist_updates_confirm_email_button({}, o);
	const linkFallback = m.waitlist_updates_confirm_email_link_fallback({}, o);
	const expiry = m.waitlist_updates_confirm_email_expiry({}, o);
	const optOut = m.waitlist_updates_confirm_email_optout({}, o);
	const optOutLabel = m.waitlist_updates_confirm_email_optout_label({}, o);
	const separate = m.waitlist_updates_confirm_email_separate({}, o);
	const signoff = m.waitlist_updates_confirm_email_signoff({}, o);

	const greeting = m.waitlist_updates_confirm_email_greeting({}, o);

	// --- text/plain ---
	const text = [
		greeting,
		'',
		body,
		'',
		input.confirmUrl,
		'',
		expiry,
		'',
		optOut,
		input.unsubscribeUrl,
		'',
		separate,
		'',
		signoff
	].join('\n');

	// --- text/html (escape every dynamic value; the Paraglide prose is trusted) ---
	const confirmHref = escapeHtml(input.confirmUrl);
	const unsubscribeHref = escapeHtml(input.unsubscribeUrl);
	const html =
		`<div style="font:14px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">` +
		`<p>${greeting}</p>` +
		`<p>${body}</p>` +
		`<p style="margin:24px 0"><a href="${confirmHref}" ` +
		`style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;` +
		`text-decoration:none;border-radius:6px;font-weight:600">${button}</a></p>` +
		`<p style="color:#64748b;margin-bottom:4px">${linkFallback}</p>` +
		`<p style="margin:0 0 16px;word-break:break-all"><a href="${confirmHref}" style="color:#2563eb">${confirmHref}</a></p>` +
		`<p style="color:#64748b">${expiry}</p>` +
		`<p style="color:#64748b">${optOut} ` +
		`<a href="${unsubscribeHref}" style="color:#2563eb">${optOutLabel}</a></p>` +
		`<p style="color:#64748b">${separate}</p>` +
		`<p style="color:#64748b">${signoff}</p>` +
		`</div>`;

	return {
		from: FROM,
		to: input.to,
		replyTo: CONTACT_EMAIL,
		subject,
		text,
		html,
		headers: AUTO_REPLY_HEADERS
	};
}

/**
 * Build + POST the confirmation request. Throws on a Resend failure — the caller runs this
 * fire-and-forget inside `ctx.waitUntil` and logs, like every other visitor-triggered send.
 *
 * A failure costs this address its window rather than its only chance: the claim reopens after a day,
 * so a re-tick asks again. That is the whole reason the cap is a rate and not DAR-82's once-ever
 * quota, and it is why "claim before send" is affordable here.
 */
export async function sendUpdatesConfirmEmail(
	apiKey: string,
	input: UpdatesConfirmEmailInput,
	locale: Locale
): Promise<void> {
	await postEmail(apiKey, buildUpdatesConfirmEmail(input, locale));
}

/** Where the two landing pages live. One place, so a rename can't move only half the pair. */
export const UPDATES_CONFIRM_PATH = '/updates/confirm';
export const UPDATES_UNSUBSCRIBE_PATH = '/updates/unsubscribe';

/**
 * Build one of the two landing-page URLs.
 *
 * FROM THE CONFIGURED `ORIGIN`, never from the request's own `url.origin` — DAR-82's rule, and it bites
 * harder here than it did there. `url.origin` follows the incoming Host header, which a caller chooses,
 * so a forged Host would put an attacker's domain behind a "confirm" button in mail we send to a member
 * of the public. ORIGIN is configured, not received.
 */
const updatesUrl = (origin: string, path: string, token: string): string =>
	`${origin.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`;

/** The request-scoped values the send needs, all read before the first await by the caller. */
export interface UpdatesConfirmEnv {
	resendKey: string | undefined;
	/** The site's configured ORIGIN — see `updatesUrl`. */
	origin: string | undefined;
	/** The waitlist signing secret, from the one resolver (DAR-99). */
	secret: WaitlistSigningSecret | undefined;
}

/** Who to ask, and which lead the answer belongs to. No name — see `buildUpdatesConfirmEmail`. */
export interface UpdatesConfirmTarget {
	leadId: string;
	email: string;
}

/**
 * Ask this address to confirm, if a ticked box has earned an ask. Never throws, never blocks, returns
 * nothing — a caller cannot accidentally make it fail somebody's signup.
 *
 * NOT GATED ON `isNew`, unlike the two signup emails beside it, and that is a deliberate difference
 * rather than an oversight. `isNew` is the right mailbomb guard for a welcome, which is a once-ever
 * message about a once-ever event. Reusing it here would mean every address already on the list — and
 * anyone who signs up twice — could tick the box forever and never be asked, so the gate would ship
 * unusable for exactly the people already behind it. The bound is `claimUpdatesConfirmSend` instead:
 * one ask per address per day, never after a confirmation or a withdrawal.
 *
 * EVERY PRECONDITION IS CHECKED BEFORE THE CLAIM. A deploy with no Resend key, no signing secret or no
 * ORIGIN can send nothing, and claiming first would spend this address's window on a send that cannot
 * happen — DAR-82's rule, with the difference that a window reopens and its column never did. Missing
 * any of the three simply means the gate is off, which is the same posture the rest of the flow takes
 * when its secret is absent.
 *
 * FIRE-AND-FORGET INCLUDING THE CLAIM, both inside `ctx.waitUntil`. Awaiting a conditional UPDATE would
 * add a round trip to exactly the submits that tick the box, and whether it matched a row answers "has
 * this address been asked before?" — a question about state the visitor cannot see. Off the response
 * path, that timing difference does not exist to measure.
 */
export function captureUpdatesConsent(
	db: Db,
	platform: App.Platform | undefined,
	env: UpdatesConfirmEnv,
	target: UpdatesConfirmTarget,
	locale: Locale
): void {
	const { resendKey, origin, secret } = env;
	if (!resendKey || !origin || !secret) return;

	const send = (async () => {
		// Claim first — see claimUpdatesConfirmSend. False means already confirmed, already withdrawn,
		// asked within the window, or the lead is gone; nothing to do in any of those cases.
		if (!(await claimUpdatesConfirmSend(db, target.leadId))) return;
		await sendUpdatesConfirmEmail(
			resendKey,
			{
				to: target.email,
				confirmUrl: updatesUrl(
					origin,
					UPDATES_CONFIRM_PATH,
					await mintUpdatesConfirmToken(secret, target.leadId)
				),
				unsubscribeUrl: updatesUrl(
					origin,
					UPDATES_UNSUBSCRIBE_PATH,
					await mintUpdatesUnsubscribeToken(secret, target.leadId)
				)
			},
			locale
		);
	})().catch((err: unknown) => {
		// Logged by role, never with the recipient address — the rule every waitlist send follows.
		console.error('waitlist updates confirmation email failed', err);
	});

	platform?.ctx?.waitUntil(send);
}
