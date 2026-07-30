// The shared layout for a TRANSACTIONAL LINK EMAIL — "here is a one-time link, click it" — which is
// the shape of every non-fan-out message this site sends: the password reset (self-service), the
// sign-up verification (#96), and the early-access activation (DAR-67).
//
// WHY THIS EXISTS. Those three modules were byte-identical apart from their message-key prefix and a
// `*_FROM` constant: same text/plain assembly, same 35-line HTML body, same palette inlined three
// times over. Normalizing away the prefix, two of them diffed to nothing at all and the third to one
// line of prettier wrapping. So the copy was the only real difference, and the template was a clone
// waiting to be cloned again.
//
// WHAT IS DELIBERATELY *NOT* HERE: DAR-139's updates confirmation (`waitlist-updates-notify.ts`),
// which is the fourth message to reuse this shell's markup and is NOT a fourth instance of it. It
// takes TWO links rather than one (the unsubscribe is a promise `/privacy` makes about every update,
// including this one), greets nobody by name **on purpose** — it is the single message whose premise
// is that the submitter and the recipient may be different people — carries RFC 3834 auto-reply
// headers, and has no "if you didn't ask for this" line. Every one of those is a decision its own
// module documents, so folding it in means optional fields and conditional rendering: a configurable
// template rather than a shared one, which is how this kind of extraction rots. What it and these
// three DO share is the shell markup — the wrapper div, the CTA button, the fallback-link block, now
// four copies of the same palette — and unifying THAT is a separate extraction with a separate
// judgement call, not an oversight here. Resist the urge to widen `LinkEmailCopy` to reach it.
//
// WHERE THE SEAM IS, AND WHY IT IS NOT THE SEND. The obvious extraction is one function that builds
// AND posts, leaving three one-line callers. Do not: `email-senders.spec.ts` (DAR-121) derives its
// surface from which files import `postEmail` and holds each against an allowlist declaring `kind`
// and a per-call-site `sends` count. Funnel the send through here and seven declared entries collapse
// to one, which is exactly the "a send appended inside an already-listed file inherits that file's
// pass" defect DAR-102 measured — the per-file `kind` is what makes "we send no marketing" a claim a
// diff can contradict. So this module is a BUILDER ONLY. It never imports `postEmail` and every
// mailer keeps its own send.
//
// That is enforced, not merely asked for: adding a `postEmail` import here makes this an undeclared
// sender, and the spec's "lets only declared modules import the send function" assertion fails. The
// wrong move would be to silence it by adding this file to the allowlist — the entry would describe a
// module that sends everything and therefore says nothing about any of it.
//
// WHAT THE CALLER STILL OWNS: its copy (the eight-message family below), its own `send*` wrapper, and
// the failure policy on it — the activation send is the one AWAITED, surfaced mail in the repo
// (activation-email.ts says why), and that difference is deliberately not abstracted away.
import { CONTACT_EMAIL, EMAIL_FROM } from '$lib/site';
import { type OutboundEmail, escapeHtml } from './email';

/** The dynamic half — identical across the three, and all of it caller-supplied, so both fields are
 * escaped in the HTML body (`url` included: the token is ours, but an `&` in a query string would
 * otherwise break out of the href attribute). */
export interface LinkEmailInput {
	/** The recipient. */
	to: string;
	/** Display name for the greeting. */
	name: string;
	/** The one-time link this email exists to deliver. */
	url: string;
}

/**
 * One email's copy, already resolved for a locale.
 *
 * Resolved STRINGS rather than a message-key prefix, so each caller keeps its own Paraglide call
 * sites and the compiler still checks every key it names — a prefix passed as a string would turn
 * `m[`${prefix}_email_body`]` into an unchecked lookup and hand back exactly the silent-typo failure
 * that a shared template makes easy (three structurally identical modules, one wrong prefix on one
 * line, no visible difference). The per-family specs assert all eight pieces reach the output.
 *
 * `greeting` is a function, not a string, because it takes the name and is rendered TWICE — once raw
 * for text/plain and once with the name escaped for the HTML body.
 */
export interface LinkEmailCopy {
	subject: string;
	greeting: (args: { name: string }) => string;
	body: string;
	button: string;
	linkFallback: string;
	/** How long the link is good for. NOT shared: the activation token gets a week, a self-service
	 * reset an hour, and copy that misstates it sends people to a dead link (DAR-67). */
	expiry: string;
	ignore: string;
	signoff: string;
}

/**
 * Render a transactional link email. Pure — no env, no clock, no request. Sent FROM the
 * Resend-verified role alias with Reply-To the monitored info@ inbox, which matters for all three:
 * an unexpected invitation or reset is precisely the mail someone wants to ask a human about.
 *
 * The Paraglide prose is trusted; every interpolated caller value is escaped. text/plain carries the
 * URL raw (it is not markup) and the name verbatim.
 */
export function buildLinkEmail(copy: LinkEmailCopy, input: LinkEmailInput): OutboundEmail {
	// --- text/plain ---
	const text = [
		copy.greeting({ name: input.name }),
		'',
		copy.body,
		'',
		input.url,
		'',
		copy.expiry,
		'',
		copy.ignore,
		'',
		copy.signoff
	].join('\n');

	// --- text/html (inline styles only — the one styling idiom mail clients agree on) ---
	const greetingHtml = copy.greeting({ name: escapeHtml(input.name) });
	const href = escapeHtml(input.url);
	const html =
		`<div style="font:14px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">` +
		`<p>${greetingHtml}</p>` +
		`<p>${copy.body}</p>` +
		`<p style="margin:24px 0"><a href="${href}" ` +
		`style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;` +
		`text-decoration:none;border-radius:6px;font-weight:600">${copy.button}</a></p>` +
		// The link repeated as text, for a client that strips the button or a recipient who copies it.
		`<p style="color:#64748b;margin-bottom:4px">${copy.linkFallback}</p>` +
		`<p style="margin:0 0 16px;word-break:break-all"><a href="${href}" style="color:#2563eb">${href}</a></p>` +
		`<p style="color:#64748b">${copy.expiry}</p>` +
		`<p style="color:#64748b">${copy.ignore}</p>` +
		`<p style="color:#64748b">${copy.signoff}</p>` +
		`</div>`;

	return {
		from: EMAIL_FROM,
		to: input.to,
		replyTo: CONTACT_EMAIL,
		subject: copy.subject,
		text,
		html
	};
}
