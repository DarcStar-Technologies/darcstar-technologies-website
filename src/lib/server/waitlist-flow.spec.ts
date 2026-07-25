import { describe, expect, it } from 'vitest';
import { canonicalizeWaitlistRole, isCommercialUseCase, nextStepAfterStep2 } from './waitlist-flow';
import { WAITLIST_ROLES } from '$lib/waitlist-roles';
import { WAITLIST_V2_ROLES, WAITLIST_APPLICATIONS } from '$lib/waitlist-qualification';

describe('canonicalizeWaitlistRole', () => {
	it('passes v2 slugs through unchanged', () => {
		for (const role of WAITLIST_V2_ROLES) {
			expect(canonicalizeWaitlistRole(role)).toBe(role);
		}
	});

	// The `role` column carries both sets (v1 rows are history), so a branching consumer must map
	// v1 → v2 or a legacy `research` signup reads as a commercial prospect.
	it('maps every legacy v1 slug to a v2 slug', () => {
		expect(WAITLIST_ROLES.map(canonicalizeWaitlistRole)).toEqual([
			'founder-executive',
			'engineering-leader',
			'product-operations',
			'researcher',
			'product-operations',
			'investor-advisor',
			'student',
			'other'
		]);
		// Every v1 slug lands on a real v2 slug — no typo'd target.
		for (const role of WAITLIST_ROLES) {
			expect(WAITLIST_V2_ROLES).toContain(canonicalizeWaitlistRole(role));
		}
	});

	it('treats absent and unrecognized values as no answer', () => {
		expect(canonicalizeWaitlistRole(null)).toBeNull();
		expect(canonicalizeWaitlistRole(undefined)).toBeNull();
		expect(canonicalizeWaitlistRole('')).toBeNull();
		expect(canonicalizeWaitlistRole('cto-of-vibes')).toBeNull();
	});
});

// The gating rule, restated independently of the implementation: these route PAST step 3.
const NON_COMMERCIAL_ROLES = ['researcher', 'student', 'investor-advisor'];
const NON_COMMERCIAL_APPLICATIONS = ['research-education'];

// Every role the predicate can see: both slug sets, plus the two "no signal" shapes.
const ROLE_INPUTS = [...WAITLIST_V2_ROLES, ...WAITLIST_ROLES, null, 'not-a-role'];
const APPLICATION_INPUTS = [...WAITLIST_APPLICATIONS, null, 'not-an-application'];

describe('isCommercialUseCase', () => {
	// DAR-62 acceptance: exercised for every role × application combination (v1 and v2 role slugs,
	// unanswered, and tampered values).
	it.each(ROLE_INPUTS)('classifies role %s against every application', (role) => {
		for (const primaryApplication of APPLICATION_INPUTS) {
			const canonicalRole = canonicalizeWaitlistRole(role);
			const application = (WAITLIST_APPLICATIONS as readonly string[]).includes(
				primaryApplication ?? ''
			)
				? primaryApplication
				: null;

			const expected =
				(canonicalRole !== null || application !== null) &&
				!(canonicalRole !== null && NON_COMMERCIAL_ROLES.includes(canonicalRole)) &&
				!(application !== null && NON_COMMERCIAL_APPLICATIONS.includes(application));

			expect(
				isCommercialUseCase({ role, primaryApplication }),
				`${role} / ${primaryApplication}`
			).toBe(expected);
		}
	});

	// Hand-written anchors, so an inverted formula above can't agree with itself.
	it('needs a positive signal — an unanswered step 2 is not commercial', () => {
		expect(isCommercialUseCase({ role: null, primaryApplication: null })).toBe(false);
		expect(isCommercialUseCase({ role: 'not-a-role', primaryApplication: 'nope' })).toBe(false);
	});

	it('accepts one answered, non-excluded field as enough', () => {
		expect(isCommercialUseCase({ role: 'engineering-leader', primaryApplication: null })).toBe(
			true
		);
		expect(
			isCommercialUseCase({ role: null, primaryApplication: 'robotics-autonomous-systems' })
		).toBe(true);
		expect(isCommercialUseCase({ role: 'other', primaryApplication: null })).toBe(true);
	});

	it('excludes the non-commercial roles even with a commercial application', () => {
		for (const role of NON_COMMERCIAL_ROLES) {
			expect(
				isCommercialUseCase({ role, primaryApplication: 'industrial-infrastructure-control' })
			).toBe(false);
		}
		// …and the legacy v1 spellings of the same people.
		expect(
			isCommercialUseCase({ role: 'research', primaryApplication: 'financial-market-control' })
		).toBe(false);
		expect(
			isCommercialUseCase({ role: 'investor', primaryApplication: 'ai-agents-llm-systems' })
		).toBe(false);
	});

	it('excludes a research-or-education application even with a commercial role', () => {
		expect(
			isCommercialUseCase({ role: 'founder-executive', primaryApplication: 'research-education' })
		).toBe(false);
	});
});

describe('nextStepAfterStep2', () => {
	it('sends a commercial Continue to step 3', () => {
		expect(
			nextStepAfterStep2({
				skipped: false,
				role: 'safety-risk-compliance',
				primaryApplication: 'industrial-infrastructure-control'
			})
		).toBe('step3');
	});

	it('routes a non-commercial Continue past step 3', () => {
		expect(nextStepAfterStep2({ skipped: false, role: 'student', primaryApplication: null })).toBe(
			'done'
		);
		expect(
			nextStepAfterStep2({ skipped: false, role: null, primaryApplication: 'research-education' })
		).toBe('done');
	});

	it('routes an unanswered Continue past step 3', () => {
		expect(nextStepAfterStep2({ skipped: false, role: null, primaryApplication: null })).toBe(
			'done'
		);
	});

	// "Skip for now" means stop asking, so it terminates even when the selects were filled first
	// (that submission writes nothing either — see waitlist-steps.remote.ts).
	it('always terminates on Skip, even with commercial answers', () => {
		expect(
			nextStepAfterStep2({
				skipped: true,
				role: 'engineering-leader',
				primaryApplication: 'robotics-autonomous-systems'
			})
		).toBe('done');
	});
});
