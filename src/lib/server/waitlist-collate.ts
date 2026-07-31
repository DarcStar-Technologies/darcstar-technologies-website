// Collation for /admin/waitlist (DAR-88) — turning an append-only submission log back into one row
// per person for triage, WITHOUT resolving anything.
//
// This is the read-time half of the append-only model, and the constraint that shapes it is that it
// must not pick winners. Two different phone numbers for one address is information: it means either
// someone corrected themselves or someone else submitted their address, and which of those it is takes
// human judgement. The pre-DAR-88 store answered it in the write path — provided-wins, then
// fill-forward for the sensitive columns — and either way the losing value was destroyed before anyone
// saw it. Here, both survive on their own submissions and the disagreement is FLAGGED so an operator
// looks at it.
//
// Under $lib/server for DAR-65's reason: this is an internal triage view, and SvelteKit's import guard
// makes "no public page can reach it" structural rather than a convention. The page needs no import —
// its `PageData` is inferred from the load's return.
import { classifyWaitlistLead, classifyWaitlistLeadGroup } from './waitlist-classify';
import { waitlistInviteState, type WaitlistInviteState } from '$lib/waitlist-invite';
import {
	waitlistUpdatesState,
	type WaitlistUpdatesSignals,
	type WaitlistUpdatesState
} from '$lib/waitlist-updates';
import type { WaitlistOutreachSignals } from '$lib/waitlist-outreach';
import type { WaitlistLeadClass } from '$lib/waitlist-qualification';

/**
 * Everything a submission can carry an ANSWER in — as opposed to provenance (ip_hash, user_agent,
 * timestamps, the step-write counters), which is per-submission fact that is SUPPOSED to differ, and
 * `email`, which cannot disagree because it is what resolves the lead.
 */
export interface WaitlistAnswers {
	name: string | null;
	company: string | null;
	role: string | null;
	companySize: string | null;
	interest: string | null;
	hearAbout: string | null;
	phone: string | null;
	countryRegion: string | null;
	primaryApplication: string | null;
	evaluationTimeline: string | null;
	currentApproach: string | null;
	economicImpact: string | null;
	budgetRange: string | null;
	adoptionEvidence: string[] | null;
	pilotInterest: string | null;
	loiReadiness: string | null;
	deploymentScale: string | null;
	contactPermission: boolean | null;
	contactMethod: string | null;
	researchPreferences: string[] | null;
}

/**
 * The answer columns compared across a lead's submissions — ALL of them, deliberately, not a
 * hand-picked "sensitive" subset. Picking a subset is the mistake DAR-72 had to correct once already
 * (it needed a taxonomy of which columns were "actionable"), and here it has no upside: flagging is
 * free, and a disagreement about `current_approach` is as much a sign of two different people as one
 * about `phone`.
 */
export const WAITLIST_CONFLICT_FIELDS = [
	'name',
	'company',
	'role',
	'companySize',
	'interest',
	'hearAbout',
	'phone',
	'countryRegion',
	'primaryApplication',
	'evaluationTimeline',
	'currentApproach',
	'economicImpact',
	'budgetRange',
	'adoptionEvidence',
	'pilotInterest',
	// Worth flagging as loudly as any other disagreement (DAR-112): two submissions under one address
	// giving different letter-of-intent answers is exactly the "correction, or a stranger?" question
	// this list exists to put in front of a human, and it is the answer with the most to lose from a
	// wrong guess.
	'loiReadiness',
	'deploymentScale',
	'contactPermission',
	'contactMethod',
	'researchPreferences'
] as const satisfies readonly (keyof WaitlistAnswers)[];

export type WaitlistConflictField = (typeof WAITLIST_CONFLICT_FIELDS)[number];

// "All of them" enforced in both directions, so the list can't quietly fall behind the type. The
// `satisfies` above rejects a field that isn't an answer; this rejects an answer that isn't in the
// list, which is the direction that fails SILENTLY — a new column would simply never be compared, and
// two submitters could disagree about it with nothing on screen to say so.
type EveryAnswerCompared = keyof WaitlistAnswers extends WaitlistConflictField ? true : false;
const _everyAnswerCompared: EveryAnswerCompared = true;
void _everyAnswerCompared;

/**
 * Comparable form of one answer. Arrays compare by their SORTED contents, so ["a","b"] and ["b","a"]
 * are the same answer given in a different checkbox order rather than a conflict — the columns are
 * sets, and the storage order is an artifact of how the form was filled in.
 */
const comparable = (value: string | string[] | boolean | null): string | null => {
	if (value === null) return null;
	if (Array.isArray(value)) return value.length === 0 ? null : JSON.stringify([...value].sort());
	return String(value);
};

/**
 * Which fields two or more submissions actually DISAGREE about.
 *
 * A null never conflicts. Not answering a question is not contradicting someone who did — under
 * progressive disclosure most submissions leave most fields blank, so counting absence as
 * disagreement would flag essentially every lead with more than one submission and the signal would
 * be worth nothing. Only two different NON-NULL answers count.
 */
export function conflictingFields(
	submissions: readonly WaitlistAnswers[]
): WaitlistConflictField[] {
	if (submissions.length < 2) return [];
	return WAITLIST_CONFLICT_FIELDS.filter((field) => {
		const seen = new Set<string>();
		for (const submission of submissions) {
			const value = comparable(submission[field]);
			if (value !== null) seen.add(value);
			if (seen.size > 1) return true;
		}
		return false;
	});
}

/** The lead columns collation needs. Answers live on the submissions, never here. */
export interface WaitlistLeadRow extends WaitlistUpdatesSignals, WaitlistOutreachSignals {
	id: string;
	email: string;
	invitedAt: Date | null;
	invitedBy: string | null;
	activatedAt: Date | null;
	/**
	 * Who recorded the withdrawal (DAR-140) — null meaning the mailbox holder used the emailed link, a
	 * staff id meaning we recorded a request that reached us another way. Beside the signals rather than
	 * inside them, because `waitlistUpdatesState` derives from the three timestamps and must not see
	 * this: provenance is not state.
	 */
	updatesUnsubscribedBy: string | null;
	/**
	 * "Don't contact me" (DAR-191) — the outreach axis, and a LEAD-level fact for the same reason the
	 * updates columns are. Extended from `WaitlistOutreachSignals` rather than restated, so the badge
	 * and `mayContactLead` cannot end up reading different shapes.
	 */
	doNotContactBy: string | null;
	reviewedAt: Date | null;
	reviewedBy: string | null;
	createdAt: Date;
}

/** A submission as the admin load selects it: its answers plus its own id and timestamps. */
export type WaitlistSubmissionRow = WaitlistAnswers & {
	id: string;
	leadId: string;
	email: string;
	consentUpdates: boolean;
	consentUpdatesAt: Date | null;
	qualificationStep: number | null;
	createdAt: Date;
	updatedAt: Date;
};

export type CollatedWaitlistLead = WaitlistLeadRow & {
	/** Newest first — the order an operator reads them in, most recent claim at the top. */
	submissions: (WaitlistSubmissionRow & { leadClass: WaitlistLeadClass })[];
	/** The strongest band any single submission earned — see classifyWaitlistLeadGroup. */
	leadClass: WaitlistLeadClass;
	inviteState: WaitlistInviteState;
	/**
	 * Where this address stands on product-and-research updates (DAR-139) — a LEAD-level fact, and
	 * deliberately shown beside the per-submission `consent_updates` claims rather than instead of them.
	 * The claims say what each submitter typed; this says whether the mailbox ever answered, which is
	 * the only thing that authorizes a send.
	 */
	updatesState: WaitlistUpdatesState;
	/** Fields whose answers disagree across submissions. Empty for the overwhelming majority. */
	conflicts: WaitlistConflictField[];
	/** When we last heard from this person, i.e. their newest submission (null if somehow none). */
	latestAt: Date | null;
	/**
	 * True when a submission has arrived since the last review stamp — including the first-ever
	 * submission on a never-reviewed lead. This is the "hold for human review" state the whole model
	 * is for, and it is DERIVED rather than a column, so a new submission re-opens a reviewed lead
	 * automatically instead of needing the review action to remember to un-set a flag.
	 */
	needsReview: boolean;
};

/**
 * Group submissions under their leads and decorate each lead for triage.
 *
 * Pure and order-preserving: `leads` arrives in the order the caller wants them displayed and comes
 * back the same way. Submissions are matched by `lead_id`; a lead with none (possible only if a
 * submission insert failed after its lead was created) collates to an empty, `research`-classed lead
 * rather than being dropped — a lead we can't explain is exactly the kind of thing an operator should
 * be able to see and delete.
 */
export function collateWaitlistLeads(
	leads: readonly WaitlistLeadRow[],
	submissions: readonly WaitlistSubmissionRow[]
): CollatedWaitlistLead[] {
	const byLead = new Map<string, WaitlistSubmissionRow[]>();
	for (const submission of submissions) {
		const bucket = byLead.get(submission.leadId);
		if (bucket) bucket.push(submission);
		else byLead.set(submission.leadId, [submission]);
	}

	return leads.map((lead) => {
		const own = (byLead.get(lead.id) ?? [])
			.slice()
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		const latestAt = own.at(0)?.createdAt ?? null;
		return {
			...lead,
			submissions: own.map((submission) => ({
				...submission,
				// Per-submission band, so the lead's badge is attributable: an operator can see WHICH
				// submission earned it rather than having to trust an aggregate.
				leadClass: classifyWaitlistLead(submission)
			})),
			leadClass: classifyWaitlistLeadGroup(own),
			inviteState: waitlistInviteState(lead),
			updatesState: waitlistUpdatesState(lead),
			conflicts: conflictingFields(own),
			latestAt,
			needsReview: latestAt !== null && (lead.reviewedAt === null || latestAt > lead.reviewedAt)
		};
	});
}
