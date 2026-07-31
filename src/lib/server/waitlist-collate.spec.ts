import { describe, expect, it } from 'vitest';
import {
	collateWaitlistLeads,
	conflictingFields,
	WAITLIST_CONFLICT_FIELDS,
	type WaitlistAnswers,
	type WaitlistLeadRow,
	type WaitlistSubmissionRow
} from './waitlist-collate';

// Pure grouping logic, so a plain unit spec. What it has to get right is entirely about NOT resolving
// things: two submitters disagreeing must survive as a flag rather than a winner, and the lead's
// priority band must never be a combination of answers no single person gave.

const noAnswers: WaitlistAnswers = {
	name: null,
	company: null,
	role: null,
	companySize: null,
	interest: null,
	hearAbout: null,
	phone: null,
	countryRegion: null,
	primaryApplication: null,
	evaluationTimeline: null,
	currentApproach: null,
	economicImpact: null,
	budgetRange: null,
	adoptionEvidence: null,
	pilotInterest: null,
	loiReadiness: null,
	deploymentScale: null,
	contactPermission: null,
	contactMethod: null,
	researchPreferences: null
};

const lead = (over: Partial<WaitlistLeadRow> = {}): WaitlistLeadRow => ({
	id: 'l1',
	email: 'ada@example.com',
	invitedAt: null,
	invitedBy: null,
	activatedAt: null,
	reviewedAt: null,
	reviewedBy: null,
	doNotContactAt: null,
	doNotContactBy: null,
	updatesConfirmSentAt: null,
	updatesConfirmedAt: null,
	updatesUnsubscribedAt: null,
	updatesUnsubscribedBy: null,
	createdAt: new Date(1_000),
	...over
});

const submission = (
	id: string,
	createdAt: number,
	over: Partial<WaitlistSubmissionRow> = {}
): WaitlistSubmissionRow => ({
	...noAnswers,
	id,
	leadId: 'l1',
	email: 'ada@example.com',
	consentUpdates: false,
	consentUpdatesAt: null,
	qualificationStep: 1,
	createdAt: new Date(createdAt),
	updatedAt: new Date(createdAt),
	...over
});

describe('conflictingFields', () => {
	it('reports nothing for a single submission', () => {
		expect(conflictingFields([submission('s1', 1, { phone: '+1 555 0100' })])).toEqual([]);
	});

	it('flags a field two submissions give different answers for', () => {
		expect(
			conflictingFields([
				submission('s1', 1, { phone: '+1 555 0100' }),
				submission('s2', 2, { phone: '+1 555 9999' })
			])
		).toEqual(['phone']);
	});

	// The whole point: BOTH values survive on their own rows, and the disagreement is surfaced rather
	// than settled. The pre-DAR-88 store answered this in the write path and destroyed the loser.
	it('flags every disagreeing field, not just the first', () => {
		const found = conflictingFields([
			submission('s1', 1, { name: 'Ada', company: 'Acme', role: 'engineering-leader' }),
			submission('s2', 2, { name: 'Mallory', company: 'Evil Corp', role: 'engineering-leader' })
		]);
		expect(found).toEqual(['name', 'company']); // role agreed, so it is not flagged
	});

	// Under progressive disclosure most submissions leave most fields blank. Counting absence as
	// disagreement would flag essentially every multi-submission lead and the signal would be worth
	// nothing.
	it('does NOT treat an unanswered field as a conflict', () => {
		expect(
			conflictingFields([
				submission('s1', 1, { phone: '+1 555 0100', company: 'Acme' }),
				submission('s2', 2) // answered nothing
			])
		).toEqual([]);
	});

	it('compares multi-selects as sets, so checkbox order is not a conflict', () => {
		expect(
			conflictingFields([
				submission('s1', 1, { adoptionEvidence: ['evaluation-pilot', 'third-party-review'] }),
				submission('s2', 2, { adoptionEvidence: ['third-party-review', 'evaluation-pilot'] })
			])
		).toEqual([]);
		expect(
			conflictingFields([
				submission('s1', 1, { adoptionEvidence: ['evaluation-pilot'] }),
				submission('s2', 2, { adoptionEvidence: ['third-party-review'] })
			])
		).toEqual(['adoptionEvidence']);
	});

	it('treats an empty multi-select as unanswered', () => {
		expect(
			conflictingFields([
				submission('s1', 1, { researchPreferences: ['technical-reports'] }),
				submission('s2', 2, { researchPreferences: [] })
			])
		).toEqual([]);
	});

	// The tri-state flag: a grant and a decline under one address is exactly the disagreement an
	// operator must see before acting, and `false` must not be mistaken for "unanswered".
	it('flags a grant against a decline, and ignores a never-asked null', () => {
		expect(
			conflictingFields([
				submission('s1', 1, { contactPermission: false }),
				submission('s2', 2, { contactPermission: true })
			])
		).toEqual(['contactPermission']);
		expect(
			conflictingFields([
				submission('s1', 1, { contactPermission: true }),
				submission('s2', 2, { contactPermission: null })
			])
		).toEqual([]);
	});

	// A field left out of the list would silently never be compared — no error, no flag, just two
	// submitters disagreeing with nothing on screen to say so. The type guard in the module catches an
	// omission at compile time; this pins the list itself at runtime.
	it('compares every answer field', () => {
		expect(WAITLIST_CONFLICT_FIELDS).toHaveLength(Object.keys(noAnswers).length);
		expect([...WAITLIST_CONFLICT_FIELDS].sort()).toEqual(Object.keys(noAnswers).sort());
	});
});

describe('collateWaitlistLeads', () => {
	it('groups submissions under their lead, newest first', () => {
		const [collated] = collateWaitlistLeads(
			[lead()],
			[submission('old', 1_000), submission('new', 5_000), submission('mid', 3_000)]
		);
		expect(collated.submissions.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
		expect(collated.latestAt).toEqual(new Date(5_000));
	});

	it('never mixes one lead’s submissions into another', () => {
		const [ada, grace] = collateWaitlistLeads(
			[lead(), lead({ id: 'l2', email: 'grace@example.com' })],
			[submission('s1', 1_000), submission('s2', 2_000, { leadId: 'l2' })]
		);
		expect(ada.submissions.map((s) => s.id)).toEqual(['s1']);
		expect(grace.submissions.map((s) => s.id)).toEqual(['s2']);
	});

	// Possible only if a submission insert failed after its lead was created. Dropping the lead would
	// hide it; showing it lets an operator see and delete it.
	it('keeps a lead with no submissions, classed at the fail-safe floor', () => {
		const [collated] = collateWaitlistLeads([lead()], []);
		expect(collated.submissions).toEqual([]);
		expect(collated.leadClass).toBe('research');
		expect(collated.latestAt).toBeNull();
		expect(collated.needsReview).toBe(false); // nothing to review
	});

	it('preserves the order it was given', () => {
		const ids = collateWaitlistLeads(
			[lead({ id: 'a' }), lead({ id: 'b' }), lead({ id: 'c' })],
			[]
		).map((l) => l.id);
		expect(ids).toEqual(['a', 'b', 'c']);
	});

	// --- Classification -------------------------------------------------------------------------

	it('takes the STRONGEST band any single submission earned, and shows the per-submission bands', () => {
		const [collated] = collateWaitlistLeads(
			[lead()],
			[
				submission('weak', 1_000, { role: 'researcher' }),
				submission('strong', 2_000, {
					role: 'engineering-leader',
					primaryApplication: 'ai-agents-llm-systems',
					evaluationTimeline: 'within-3-months',
					pilotInterest: 'yes-within-3-months'
				})
			]
		);
		expect(collated.leadClass).toBe('priority-a');
		// Newest first, so the strong one leads. Both bands stay visible so the lead's badge is
		// attributable to a specific submission rather than an unexplained aggregate.
		expect(collated.submissions.map((s) => s.leadClass)).toEqual(['priority-a', 'research']);
	});

	// THE REASON FOR CLASSIFY-THEN-MAX. Reducing the fields first (newest non-null per field) would
	// score this pair as Priority A from an authority role one person gave, a timeline another gave and
	// a pilot answer a third gave — a lead nobody actually is. Every band this returns was earned by
	// one actual submission, in full.
	it('cannot manufacture a band from answers spread across different submitters', () => {
		const [collated] = collateWaitlistLeads(
			[lead()],
			[
				submission('a', 1_000, { role: 'engineering-leader' }),
				submission('b', 2_000, {
					primaryApplication: 'ai-agents-llm-systems',
					evaluationTimeline: 'within-3-months'
				}),
				submission('c', 3_000, { pilotInterest: 'yes-within-3-months' })
			]
		);
		expect(collated.leadClass).not.toBe('priority-a');
		expect(collated.submissions.every((s) => s.leadClass !== 'priority-a')).toBe(true);
	});

	// --- Review state ---------------------------------------------------------------------------

	it('a never-reviewed lead with a submission needs review', () => {
		const [collated] = collateWaitlistLeads([lead()], [submission('s1', 1_000)]);
		expect(collated.needsReview).toBe(true);
	});

	it('a reviewed lead is settled until something new arrives', () => {
		const reviewed = lead({ reviewedAt: new Date(5_000) });
		expect(collateWaitlistLeads([reviewed], [submission('s1', 1_000)])[0].needsReview).toBe(false);
		// A submission AFTER the review re-opens it — derived, so the review action never has to
		// remember to clear a flag.
		expect(collateWaitlistLeads([reviewed], [submission('s2', 9_000)])[0].needsReview).toBe(true);
	});

	it('surfaces conflicts on the collated lead', () => {
		const [collated] = collateWaitlistLeads(
			[lead()],
			[
				submission('s1', 1_000, { phone: '+1 555 0100' }),
				submission('s2', 2_000, { phone: '+1 555 9999' })
			]
		);
		expect(collated.conflicts).toEqual(['phone']);
	});

	it('carries the lead’s own invite state through', () => {
		const [collated] = collateWaitlistLeads(
			[lead({ invitedAt: new Date(2_000), activatedAt: new Date(3_000) })],
			[submission('s1', 1_000)]
		);
		expect(collated.inviteState).toBe('activated');
	});

	// The same, for DAR-139's updates state — and it is worth its own test for the reason the invite one
	// is: dropping the derivation is a compile error, but deriving it from the WRONG thing is not, and
	// /admin/waitlist's own spec cannot catch that (its fixture sets `updatesState` directly rather than
	// collating for it). A withdrawn lead is the case that matters, because it keeps its confirmation
	// timestamp and so reads as 'confirmed' under any rule that checks that column first.
	it('carries the lead’s own updates state through, withdrawal winning', () => {
		const [collated] = collateWaitlistLeads(
			[
				lead({
					updatesConfirmSentAt: new Date(1_000),
					updatesConfirmedAt: new Date(2_000),
					updatesUnsubscribedAt: new Date(3_000)
				})
			],
			[submission('s1', 1_000)]
		);
		expect(collated.updatesState).toBe('unsubscribed');
	});
});
