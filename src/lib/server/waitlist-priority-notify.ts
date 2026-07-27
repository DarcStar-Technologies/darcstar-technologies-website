// Priority-A lead notification (DAR-82) — one email into info@ the first time any of a lead's
// submissions classifies Priority A, so a hot prospect isn't sitting unread in the triage list.
//
// Its own module rather than a third builder in waitlist-notify.ts: those two emails fan out together
// from one signup and are a fixed part of it, while this one has a different trigger (any step write),
// a different gate (a claim on the lead), and a lifecycle measured in "once per person, ever".
//
// WHY THIS IS BUILDABLE NOW. DAR-65 specified it and deliberately did not build it, because the
// notification would have been an unbounded mailbomb into info@: step 1's anti-enumeration response
// returns the same success shape — continuation token included — for a new and an existing email, so
// the token reached ANY submitter of a known address, and a stranger could therefore drive someone
// else's row to Priority A over and over. DAR-88 removed the premise rather than the symptom. Signups
// are append-only, so a token addresses the submission its own holder just created; nobody can push
// another person's row into a band. What is left is bounded twice: the per-IP signup throttle caps how
// many leads one source can mint, and the claim below caps each lead at exactly one notification.
//
// THE ONE THING THIS MUST NOT BE is a global rate cap. A shared bucket would be a
// denial-of-notification primitive — flood it with junk signups and the real Priority-A lead behind
// them goes unannounced. Per-lead has no such property: one person's abuse spends one person's budget.
//
// FIRE-AND-FORGET, and unusually strictly. `captureWaitlistPriorityLead` returns void, swallows every
// failure, and runs BOTH the claim and the send inside `ctx.waitUntil` — the same contract as
// captureWaitlistFunnel and the Resend notifications. Doing the claim after the response rather than
// before it is not just tidiness: an awaited conditional UPDATE would add a round trip on exactly the
// submits that classify Priority A, and whether it matched a row is "has this address been flagged
// before?" — a question about state the visitor can't see. Off the response path, that timing
// difference doesn't exist to measure.
import type { Db } from './db';
import type { WaitlistStepOutcome } from './waitlist-store';
import type { WaitlistLeadSignals } from './waitlist-classify';
import { classifyWaitlistLead } from './waitlist-classify';
import { canonicalizeWaitlistRole } from './waitlist-flow';
import { claimPriorityLeadNotification } from './waitlist-store';
import { type OutboundEmail, escapeHtml, postEmail } from './email';
import { CONTACT_EMAIL } from '$lib/site';
import type {
	WaitlistApplication,
	WaitlistPilotInterest,
	WaitlistTimeline,
	WaitlistV2Role
} from '$lib/waitlist-qualification';

// Internal ops output, so always English and never Paraglide — the same call waitlist-notify.ts makes
// for the lead email, and for the same hard reason: `$lib/waitlist-labels.ts` holds these slugs'
// localized labels but is client-side machinery that must never be imported under `$lib/server`.
// Keyed on the slug unions, so adding a slug without a label is a compile error rather than a blank.
const ROLE_LABELS: Record<WaitlistV2Role, string> = {
	'founder-executive': 'Founder / Executive',
	'engineering-leader': 'Engineering leader',
	researcher: 'Researcher',
	'safety-risk-compliance': 'Safety / Risk / Compliance',
	'product-operations': 'Product / Operations',
	'investor-advisor': 'Investor / Advisor',
	student: 'Student',
	other: 'Other'
};
const APPLICATION_LABELS: Record<WaitlistApplication, string> = {
	'robotics-autonomous-systems': 'Robotics / autonomous systems',
	'industrial-infrastructure-control': 'Industrial / infrastructure control',
	'financial-market-control': 'Financial / market control',
	'ai-agents-llm-systems': 'AI agents / LLM systems',
	'self-improving-software': 'Self-improving software',
	'formal-verification-infrastructure': 'Formal verification infrastructure',
	'research-education': 'Research / education',
	other: 'Other'
};
const TIMELINE_LABELS: Record<WaitlistTimeline, string> = {
	'evaluating-now': 'Evaluating now',
	'within-3-months': 'Within 3 months',
	'3-12-months': '3–12 months',
	'over-12-months': 'Over 12 months',
	'general-interest': 'General interest'
};
const PILOT_LABELS: Record<WaitlistPilotInterest, string> = {
	'yes-within-3-months': 'Yes — within 3 months',
	'yes-within-6-months': 'Yes — within 6 months',
	'yes-within-12-months': 'Yes — within 12 months',
	'possibly-contact-me': 'Possibly — contact me',
	'not-currently': 'Not currently'
};

const NOT_PROVIDED = 'Not provided';

/** Label a stored slug, falling back to the raw value so an unmapped legacy slug still reads. */
const label = (labels: Record<string, string>, value: string | null): string =>
	value === null ? NOT_PROVIDED : (labels[value] ?? value);

/**
 * What the email says about WHY this lead scored, one row per rubric input.
 *
 * `Record<keyof WaitlistLeadSignals, …>` is the guardrail, and it cuts both ways. Widening the rubric
 * with a new signal is a compile error until this email explains it — a notification that stopped
 * naming half its reasons would quietly become "trust me". And no key can exist here that isn't a
 * rubric input, which is how DAR-65's money rule reaches the mail: `economic_impact` and `budget_range`
 * are absent from `WaitlistLeadSignals` on purpose, so a self-reported dollar figure has no way into a
 * message whose subject line says "Priority A". Those numbers stay on the row detail, next to the other
 * submissions for that address, where a human can weigh them instead of being anchored by them.
 *
 * Object literal order IS render order (string keys preserve insertion order).
 */
const SIGNAL_ROWS: Record<
	keyof WaitlistLeadSignals,
	{ label: string; format: (value: string | null) => string }
> = {
	role: {
		label: 'Role',
		// Canonicalized for display, because that is the value the rubric judged: a legacy v1 slug
		// classifies as its v2 equivalent, and printing the raw slug beside the band it produced would
		// make the two look unrelated.
		format: (v) => label(ROLE_LABELS, canonicalizeWaitlistRole(v) ?? v)
	},
	primaryApplication: { label: 'Use case', format: (v) => label(APPLICATION_LABELS, v) },
	evaluationTimeline: { label: 'Timeline', format: (v) => label(TIMELINE_LABELS, v) },
	pilotInterest: { label: 'Pilot interest', format: (v) => label(PILOT_LABELS, v) }
};

const FROM = `DarcStar Waitlist <${CONTACT_EMAIL}>`;

/**
 * The triage page, filtered to the band this lead landed in.
 *
 * Built from the ORIGIN var rather than from the request's own `url.origin`, which is the obvious
 * source and the wrong one: `url.origin` follows the incoming Host header, so a request with a forged
 * Host would put an attacker-chosen link inside an email we send ourselves and act on. ORIGIN is
 * configured, not received. Absent (a misconfigured deploy, or vite dev) the email drops the link and
 * still names the page — a notification with no URL is worth sending; one with someone else's is not.
 */
const triageUrl = (origin: string | undefined): string | null =>
	origin ? `${origin.replace(/\/+$/, '')}/admin/waitlist?class=priority-a` : null;

/**
 * Render the internal Priority-A notification. Pure — unit-tested.
 *
 * Says what happened, why, and what to do next. DAR-82 notes that since DAR-67 sends invitations from
 * this very page, "a hot lead arrived" and "someone should invite them" are one operational moment, so
 * the email points at the invite rather than merely reporting a classification.
 */
export function buildWaitlistPriorityLeadEmail(
	lead: WaitlistStepOutcome,
	origin: string | undefined
): OutboundEmail {
	const subject = `Priority A waitlist lead: ${lead.email}`;
	const url = triageUrl(origin);

	const rows: [label: string, value: string][] = [
		['Email', lead.email],
		['Name', lead.name ?? NOT_PROVIDED],
		...Object.entries(SIGNAL_ROWS).map(([key, row]): [string, string] => [
			row.label,
			row.format(lead[key as keyof WaitlistLeadSignals])
		])
	];

	// Repeated verbatim from /admin/waitlist's standing caveat, because the email is read away from the
	// page that carries it and the band is our own guess from claims nobody verified. Under append-only
	// anyone can submit a known address, so "check the other submissions" is the concrete instruction,
	// not a disclaimer.
	const caveat =
		'Priority A is our own classification from unverified, self-reported answers. Anyone can ' +
		'submit any address, so check this lead’s other submissions before acting on it.';
	const action = url
		? `Invite them from ${url}`
		: 'Invite them from /admin/waitlist (filtered to Priority A).';

	const text = [rows.map(([k, v]) => `${k}: ${v}`).join('\n'), '', action, '', caveat].join('\n');
	const html =
		`<div style="font:14px/1.5 system-ui,sans-serif;color:#0f172a;max-width:560px">` +
		`<table role="presentation" cellpadding="0" cellspacing="0" style="font:inherit">` +
		rows
			.map(
				([k, v]) =>
					`<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${k}</td>` +
					`<td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`
			)
			.join('') +
		`</table>` +
		(url
			? `<p><a href="${escapeHtml(url)}">Invite them from /admin/waitlist</a></p>`
			: `<p>${escapeHtml(action)}</p>`) +
		`<p style="color:#64748b">${escapeHtml(caveat)}</p>` +
		`</div>`;

	return { from: FROM, to: CONTACT_EMAIL, replyTo: lead.email, subject, text, html };
}

/** The request-scoped values the notification needs, all read before the first await by the caller. */
export interface WaitlistPriorityNotifyEnv {
	resendKey: string | undefined;
	/** The site's configured ORIGIN — see `triageUrl` for why not the request's. */
	origin: string | undefined;
}

/**
 * Notify info@ if this step write left the submission classifying Priority A. Never throws, never
 * blocks, returns nothing — a caller cannot accidentally make it fail a visitor's step.
 *
 * `outcome` is `applyWaitlistStep`'s post-update row, so this reads the submission AS IT NOW STANDS:
 * the answer just written plus everything `coalesce` preserved from earlier steps. Null (the write was
 * refused, the row was gone, or the token was a honeypot decoy) simply does nothing.
 *
 * WIRED TO EVERY STEP, not just 4A. A positive pilot answer can only come from step 4A, but it is the
 * combination that scores, and a visitor who reloads and walks back can supply the last missing piece
 * from step 2 — provided-wins means any write can complete the triple. Gating on the step number would
 * be a rule that is true today and silently wrong after the next reload-resume change.
 *
 * THE KEY IS CHECKED BEFORE THE CLAIM. A deploy with no RESEND_API_KEY would otherwise spend each
 * lead's one-and-only notification on a send that never happens, and the column has no reset.
 */
export function captureWaitlistPriorityLead(
	// `Db`, not `Db | undefined` as captureWaitlistFunnel takes: that one is called from a load which
	// wraps `getDb()` in a try/catch, and this one only ever from a step write that already has a
	// client in hand. An escape hatch nobody uses would only invite the question of when to use it.
	db: Db,
	platform: App.Platform | undefined,
	env: WaitlistPriorityNotifyEnv,
	outcome: WaitlistStepOutcome | null
): void {
	if (outcome === null) return;
	// One submission, classified whole. That is DAR-88's rule for the admin view too: a band has to be
	// something one actual human claimed in full, never a merge of several people's best answers.
	if (classifyWaitlistLead(outcome) !== 'priority-a') return;
	const resendKey = env.resendKey;
	if (!resendKey) return;

	const send = (async () => {
		// Claim first — see claimPriorityLeadNotification for why at-most-once beats at-least-once here.
		// False means another submit (or an earlier one) already announced this person.
		if (!(await claimPriorityLeadNotification(db, outcome.leadId))) return;
		await postEmail(resendKey, buildWaitlistPriorityLeadEmail(outcome, env.origin));
	})().catch((err: unknown) => {
		// Logged by role, never with the recipient address — same rule as the other waitlist sends.
		console.error('waitlist priority-lead notification failed', err);
	});

	platform?.ctx?.waitUntil(send);
}
