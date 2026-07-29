import { describe, expect, it } from 'vitest';
import {
	classifyWaitlistLead,
	classifyWaitlistLeadGroup,
	type WaitlistLeadSignals
} from './waitlist-classify';
import { WAITLIST_ROLES } from '$lib/waitlist-roles';
import {
	WAITLIST_APPLICATIONS,
	WAITLIST_LEAD_CLASSES,
	WAITLIST_PILOT_INTERESTS,
	WAITLIST_TIMELINES,
	WAITLIST_V2_ROLES,
	waitlistLeadClassRank
} from '$lib/waitlist-qualification';

// The rubric restated independently of the implementation, so changing either has to be a deliberate
// change to BOTH. (DAR-65's acceptance: "unit-tested across the rubric matrix".)
const AUTHORITY_ROLES = [
	'founder-executive',
	'engineering-leader',
	'safety-risk-compliance',
	'product-operations'
];
const NON_COMMERCIAL_ROLES = ['researcher', 'student', 'investor-advisor'];
const IMMEDIATE_TIMELINES = ['evaluating-now', 'within-3-months'];
// Priority B's floor. Spelled out rather than imported from waitlist-flow: the point of restating
// the rubric is that a change to the shared 12-month window has to fail a test, not silently move
// the B/C boundary with it.
const ACTIVE_TIMELINES = [...IMMEDIATE_TIMELINES, '3-12-months'];
// Positive in the same sense step 4A means it — "possibly, contact me" counts, and deliberately so.
const POSITIVE_PILOTS = [
	'yes-within-3-months',
	'yes-within-6-months',
	'yes-within-12-months',
	'possibly-contact-me'
];

// Every value each column can actually hold: the real slugs, "unanswered", and a tampered string
// (these are free-text columns at the DB layer). Legacy v1 role slugs get their own test below.
const ROLE_INPUTS = [...WAITLIST_V2_ROLES, null, 'chief-vibes-officer'];
const APPLICATION_INPUTS = [...WAITLIST_APPLICATIONS, null, 'not-an-application'];
const TIMELINE_INPUTS = [...WAITLIST_TIMELINES, null, 'next-tuesday'];
const PILOT_INPUTS = [...WAITLIST_PILOT_INTERESTS, null, 'maybe-sometime'];

/** A commercial signup with everything Priority A needs; override one field per case. */
const PRIORITY_A: WaitlistLeadSignals = {
	role: 'engineering-leader',
	primaryApplication: 'robotics-autonomous-systems',
	evaluationTimeline: 'within-3-months',
	pilotInterest: 'yes-within-3-months'
};

const signals = (over: Partial<WaitlistLeadSignals> = {}): WaitlistLeadSignals => ({
	...PRIORITY_A,
	...over
});

describe('classifyWaitlistLead — the rubric matrix', () => {
	// Role × timeline × pilot, with the application held at a commercial value so the ladder is
	// actually reachable. The application axis gets its own sweep below.
	it.each(ROLE_INPUTS)('classifies role %s against every timeline and pilot answer', (role) => {
		for (const evaluationTimeline of TIMELINE_INPUTS) {
			for (const pilotInterest of PILOT_INPUTS) {
				const got = classifyWaitlistLead(signals({ role, evaluationTimeline, pilotInterest }));
				expect(WAITLIST_LEAD_CLASSES).toContain(got);

				if (role === 'investor-advisor') {
					// Role alone, ahead of every commercial signal: an investor with a three-month
					// timeline who says yes to a pilot is still not a prospective customer.
					expect(got).toBe('investor');
				} else if (NON_COMMERCIAL_ROLES.includes(String(role))) {
					expect(got).toBe('research');
				} else if (
					IMMEDIATE_TIMELINES.includes(String(evaluationTimeline)) &&
					AUTHORITY_ROLES.includes(String(role)) &&
					POSITIVE_PILOTS.includes(String(pilotInterest))
				) {
					expect(got).toBe('priority-a');
				} else if (ACTIVE_TIMELINES.includes(String(evaluationTimeline))) {
					expect(got).toBe('priority-b');
				} else {
					expect(got).toBe('priority-c');
				}
			}
		}
	});

	// With the role unanswered the application carries the whole commercial signal — and it can only
	// ever reach B, because authority is one of Priority A's three requirements.
	const NON_COMMERCIAL_APPLICATIONS = ['research-education', 'not-an-application', null];

	it.each(APPLICATION_INPUTS)(
		'classifies application %s when the role is unanswered',
		(primaryApplication) => {
			expect(classifyWaitlistLead(signals({ role: null, primaryApplication }))).toBe(
				NON_COMMERCIAL_APPLICATIONS.includes(primaryApplication) ? 'research' : 'priority-b'
			);
		}
	);
});

describe('classifyWaitlistLead — Priority A needs all three signals', () => {
	it('awards A for every authority role in the immediate window with a positive pilot answer', () => {
		for (const role of AUTHORITY_ROLES) {
			for (const evaluationTimeline of IMMEDIATE_TIMELINES) {
				for (const pilotInterest of POSITIVE_PILOTS) {
					expect(classifyWaitlistLead(signals({ role, evaluationTimeline, pilotInterest }))).toBe(
						'priority-a'
					);
				}
			}
		}
	});

	it('demotes to B when any single signal is missing', () => {
		// Timeline slips out of the immediate window but stays inside 12 months.
		expect(classifyWaitlistLead(signals({ evaluationTimeline: '3-12-months' }))).toBe('priority-b');
		// A commercial role without named authority.
		expect(classifyWaitlistLead(signals({ role: 'other' }))).toBe('priority-b');
		// The pilot question was never reached (branch B, or a skip at step 4).
		expect(classifyWaitlistLead(signals({ pilotInterest: null }))).toBe('priority-b');
		// Reached and declined.
		expect(classifyWaitlistLead(signals({ pilotInterest: 'not-currently' }))).toBe('priority-b');
	});

	// Every timeline that can reach A is inside B's window too, so dropping a non-timeline signal
	// always lands in B and never in C. That is what keeps the two windows from drifting into a gap
	// where a near-term prospect falls through to "longer-term".
	it.each(WAITLIST_TIMELINES)('keeps A a subset of B for timeline %s', (evaluationTimeline) => {
		const reachesA = classifyWaitlistLead(signals({ evaluationTimeline })) === 'priority-a';
		const withoutPilot = classifyWaitlistLead(signals({ evaluationTimeline, pilotInterest: null }));
		expect(reachesA ? withoutPilot : 'priority-b').toBe('priority-b');
	});
});

describe('classifyWaitlistLead — the money guardrail', () => {
	// The rubric's stated ordering: a modest but concrete prospect outranks an anonymous large
	// number. Not a weighting choice — the classifier has no access to the figures at all, which is
	// what these assert from the outside.
	it('ranks a concrete $25k prospect above an anonymous >$1M signup', () => {
		const concrete = classifyWaitlistLead({
			role: 'engineering-leader',
			primaryApplication: 'industrial-infrastructure-control',
			evaluationTimeline: 'within-3-months',
			pilotInterest: 'yes-within-3-months'
		});
		const anonymous = classifyWaitlistLead({
			role: null,
			primaryApplication: null,
			evaluationTimeline: null,
			pilotInterest: null
		});

		expect(concrete).toBe('priority-a');
		expect(anonymous).toBe('research');
		expect(waitlistLeadClassRank(concrete)).toBeLessThan(waitlistLeadClassRank(anonymous));
	});

	// Handing the classifier a whole row must not move the answer: the money columns sit outside its
	// input type, so they are structurally unreadable rather than merely unweighted.
	it('ignores economic impact and budget range entirely', () => {
		const base = signals({ evaluationTimeline: '3-12-months' });
		const rich = { ...base, economicImpact: 'over-1m', budgetRange: 'over-100k' };
		const poor = { ...base, economicImpact: 'under-10k', budgetRange: 'under-10k' };

		expect(classifyWaitlistLead(base)).toBe('priority-b');
		expect(classifyWaitlistLead(rich)).toBe('priority-b');
		expect(classifyWaitlistLead(poor)).toBe('priority-b');
	});
});

describe('classifyWaitlistLead — fail-safe polarity', () => {
	// Nobody is promoted by silence: the emptiest possible row lands in the least-committal bucket,
	// the direction every other decision in this flow leans.
	it('sends a signup with no answers to research/community', () => {
		expect(
			classifyWaitlistLead({
				role: null,
				primaryApplication: null,
				evaluationTimeline: null,
				pilotInterest: null
			})
		).toBe('research');
	});

	it('treats unrecognized slugs as unanswered, never as signal', () => {
		// Unknown role, real application → still commercial, but authority is gone, so A is out.
		expect(classifyWaitlistLead(signals({ role: 'chief-vibes-officer' }))).toBe('priority-b');
		// Nothing recognized at all → out of the priority bands entirely.
		expect(
			classifyWaitlistLead(
				signals({ role: 'chief-vibes-officer', primaryApplication: 'not-an-application' })
			)
		).toBe('research');
		expect(classifyWaitlistLead(signals({ evaluationTimeline: 'next-tuesday' }))).toBe(
			'priority-c'
		);
		expect(classifyWaitlistLead(signals({ pilotInterest: 'maybe-sometime' }))).toBe('priority-b');
	});
});

describe('classifyWaitlistLead — legacy v1 role slugs', () => {
	// `role` carries both slug sets, so a pre-DAR-61 row must classify like its v2 equivalent or
	// every legacy signup is silently mis-bucketed.
	it.each(WAITLIST_ROLES)('classifies legacy role %s into a real class', (role) => {
		expect(WAITLIST_LEAD_CLASSES).toContain(classifyWaitlistLead(signals({ role })));
	});

	it('maps the legacy roles onto the same buckets as their v2 twins', () => {
		expect(classifyWaitlistLead(signals({ role: 'engineering' }))).toBe('priority-a');
		expect(classifyWaitlistLead(signals({ role: 'founder' }))).toBe('priority-a');
		expect(classifyWaitlistLead(signals({ role: 'operations' }))).toBe('priority-a');
		expect(classifyWaitlistLead(signals({ role: 'research' }))).toBe('research');
		expect(classifyWaitlistLead(signals({ role: 'student' }))).toBe('research');
		expect(classifyWaitlistLead(signals({ role: 'investor' }))).toBe('investor');
	});
});

describe('waitlistLeadClassRank', () => {
	it('ranks the priority bands ahead of the non-customer buckets', () => {
		const ranks = WAITLIST_LEAD_CLASSES.map(waitlistLeadClassRank);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(waitlistLeadClassRank('priority-a')).toBe(0);
		expect(waitlistLeadClassRank('priority-c')).toBeLessThan(waitlistLeadClassRank('research'));
		expect(waitlistLeadClassRank('research')).toBeLessThan(waitlistLeadClassRank('investor'));
	});

	// Unreachable through the type, but the failure direction matters: `indexOf`'s -1 would sort an
	// unrecognized bucket ABOVE Priority A, which is the one place a triage list must not fail.
	it('ranks an unrecognized class last rather than first', () => {
		const rank = waitlistLeadClassRank('not-a-class' as (typeof WAITLIST_LEAD_CLASSES)[number]);
		expect(rank).toBeGreaterThan(waitlistLeadClassRank('investor'));
	});
});

// DAR-88 — a lead is now N submissions, so the rubric has to reduce over a group. The reduction is
// "classify each, take the strongest", and the alternative (merge the fields, then classify) is what
// these pin it against.
describe('classifyWaitlistLeadGroup', () => {
	// `signals()` above fills in PRIORITY_A for everything unset, which is the right default for the
	// matrix tests but the wrong one here: these need submissions that answered ONE thing, so that
	// splitting a band's requirements across several of them really does split them.
	const BLANK: WaitlistLeadSignals = {
		role: null,
		primaryApplication: null,
		evaluationTimeline: null,
		pilotInterest: null
	};
	const only = (over: Partial<WaitlistLeadSignals>): WaitlistLeadSignals => ({ ...BLANK, ...over });

	it('matches classifyWaitlistLead for a single submission', () => {
		for (const role of ROLE_INPUTS) {
			for (const evaluationTimeline of TIMELINE_INPUTS) {
				const one = signals({ role, evaluationTimeline });
				expect(classifyWaitlistLeadGroup([one])).toBe(classifyWaitlistLead(one));
			}
		}
	});

	it('takes the strongest band, regardless of the order the submissions arrive in', () => {
		const weak = signals({ role: 'researcher' });
		expect(classifyWaitlistLeadGroup([weak, PRIORITY_A])).toBe('priority-a');
		expect(classifyWaitlistLeadGroup([PRIORITY_A, weak])).toBe('priority-a');
	});

	// THE POINT OF CLASSIFYING FIRST. Split Priority A's three requirements across three different
	// submissions: no single submitter gave the combination, so no Priority A may be reported. A
	// field-merge reduction would score this as A — a lead nobody actually is — which is the same
	// class of error as the write-path merging DAR-88 removed.
	it('never assembles a band from answers given by different submitters', () => {
		const spread: WaitlistLeadSignals[] = [
			only({ role: PRIORITY_A.role }),
			only({
				primaryApplication: PRIORITY_A.primaryApplication,
				evaluationTimeline: PRIORITY_A.evaluationTimeline
			}),
			only({ pilotInterest: PRIORITY_A.pilotInterest })
		];
		// Every requirement is present SOMEWHERE in the group, and none of them together in one row.
		expect(spread.map(classifyWaitlistLead)).not.toContain('priority-a');
		expect(classifyWaitlistLeadGroup(spread)).not.toBe('priority-a');
	});

	// Fail-safe floor: nobody is promoted by silence, including the silence of an empty group (a lead
	// whose submission insert failed after its lead row was created).
	it('classes an empty group exactly as it classes a blank submission', () => {
		expect(classifyWaitlistLeadGroup([])).toBe(classifyWaitlistLead(BLANK));
		expect(classifyWaitlistLeadGroup([])).toBe('research');
	});

	// The band it returns is always one a real submission earned — so the badge stays attributable to
	// a row an operator can open and read.
	it('returns a band some submission in the group actually earned', () => {
		for (const role of ROLE_INPUTS) {
			for (const pilotInterest of PILOT_INPUTS) {
				const group = [only({ role }), only({ pilotInterest }), PRIORITY_A];
				expect(group.map(classifyWaitlistLead)).toContain(classifyWaitlistLeadGroup(group));
			}
		}
	});
});
