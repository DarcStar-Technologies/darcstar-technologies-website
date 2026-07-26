import { describe, expect, it } from 'vitest';
import {
	canonicalizeWaitlistRole,
	isCommercialUseCase,
	nextStepAfterStep2,
	nextStepAfterStep3,
	step4BranchFor,
	mintWaitlistBranchClaim,
	verifyWaitlistBranchClaim
} from './waitlist-flow';
import { mintWaitlistToken, mintSignedValue, WAITLIST_TOKEN_TTL_SECONDS } from './waitlist-token';
import { WAITLIST_ROLES } from '$lib/waitlist-roles';
import {
	WAITLIST_V2_ROLES,
	WAITLIST_APPLICATIONS,
	WAITLIST_TIMELINES
} from '$lib/waitlist-qualification';

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

// DAR-63's fork rule, restated independently of the implementation: these earn branch A.
const ACTIVE_TIMELINES = ['evaluating-now', 'within-3-months', '3-12-months'];

describe('step4BranchFor', () => {
	// DAR-63 acceptance: the branch routing is exercised for every timeline the form can submit,
	// plus the shapes it can't (unanswered, tampered).
	it.each([...WAITLIST_TIMELINES, null, undefined, '', 'next-tuesday'])(
		'routes timeline %s',
		(timeline) => {
			const expected = ACTIVE_TIMELINES.includes(timeline ?? '') ? 'step4a' : 'step4b';
			expect(step4BranchFor(timeline), String(timeline)).toBe(expected);
		}
	);

	// Hand-written anchors, so an inverted formula above can't agree with itself.
	it('sends the near-term timelines to branch A', () => {
		expect(step4BranchFor('evaluating-now')).toBe('step4a');
		expect(step4BranchFor('3-12-months')).toBe('step4a');
	});

	it('needs a positive signal — unanswered and unrecognized fall to branch B', () => {
		expect(step4BranchFor(null)).toBe('step4b');
		expect(step4BranchFor('over-12-months')).toBe('step4b');
		expect(step4BranchFor('general-interest')).toBe('step4b');
		expect(step4BranchFor('yes-please')).toBe('step4b');
	});
});

// The claim is what stops a visitor opting into branch A's contact-collection by editing the hidden
// field it rides in (DAR-63 acceptance). It inherits the token's canonicalization + expiry rules
// (pinned in waitlist-token.spec.ts); what's pinned here is that it can't be forged or confused with
// a continuation token.
const SECRET = 'test-secret-not-a-real-one';
const NOW = 1_800_000_000_000; // fixed ms clock — determinism, no Date.now() flake

describe('the step-4 branch claim', () => {
	it('roundtrips both branches', async () => {
		for (const branch of ['step4a', 'step4b'] as const) {
			const claim = await mintWaitlistBranchClaim(SECRET, branch, NOW);
			await expect(verifyWaitlistBranchClaim(SECRET, claim, NOW)).resolves.toBe(branch);
		}
	});

	it('rejects a claim edited from B to A (the whole point of signing it)', async () => {
		const claim = await mintWaitlistBranchClaim(SECRET, 'step4b', NOW);
		const forged = claim.replace('step4b', 'step4a');
		expect(forged).not.toBe(claim); // the payload really is in the string
		await expect(verifyWaitlistBranchClaim(SECRET, forged, NOW)).resolves.toBeNull();
	});

	it('rejects an expired claim and one minted with a different secret', async () => {
		const claim = await mintWaitlistBranchClaim(SECRET, 'step4a', NOW);
		const atExpiry = NOW + WAITLIST_TOKEN_TTL_SECONDS * 1000;
		await expect(verifyWaitlistBranchClaim(SECRET, claim, atExpiry)).resolves.toBeNull();
		await expect(
			verifyWaitlistBranchClaim(SECRET, await mintWaitlistBranchClaim('other', 'step4a', NOW), NOW)
		).resolves.toBeNull();
	});

	// Domain separation: the two signed values key off the SAME secret, so neither may verify as the
	// other. A row id is not a branch, and a branch claim authorizes no write.
	it('never accepts a continuation token, and its own value is not a token', async () => {
		const token = await mintWaitlistToken(SECRET, 'row-1', NOW);
		await expect(verifyWaitlistBranchClaim(SECRET, token, NOW)).resolves.toBeNull();

		// Even with the claim's prefix, a MAC signed under the token's domain must not verify.
		const wrongDomain = await mintSignedValue(
			SECRET,
			'darcstar:waitlist-continuation:v1',
			'b1',
			'step4a',
			WAITLIST_TOKEN_TTL_SECONDS,
			NOW
		);
		await expect(verifyWaitlistBranchClaim(SECRET, wrongDomain, NOW)).resolves.toBeNull();
	});

	it('rejects malformed shapes without throwing (generic null — no oracle)', async () => {
		for (const junk of [null, undefined, 42, '', 'step4a', 'b1', 'b1.step4a.9999999999.@@@@']) {
			await expect(verifyWaitlistBranchClaim(SECRET, junk, NOW)).resolves.toBeNull();
		}
	});
});

describe('nextStepAfterStep2', () => {
	it('sends a commercial Continue to step 3, whatever the timeline says', () => {
		for (const evaluationTimeline of [...WAITLIST_TIMELINES, null]) {
			expect(
				nextStepAfterStep2({
					skipped: false,
					role: 'safety-risk-compliance',
					primaryApplication: 'industrial-infrastructure-control',
					evaluationTimeline
				})
			).toBe('step3');
		}
	});

	// Non-commercial visitors never see step 3 — they fork straight to a step-4 branch, chosen by the
	// timeline they just gave us.
	it('forks a non-commercial Continue straight to a step-4 branch', () => {
		expect(
			nextStepAfterStep2({
				skipped: false,
				role: 'student',
				primaryApplication: null,
				evaluationTimeline: 'general-interest'
			})
		).toBe('step4b');
		expect(
			nextStepAfterStep2({
				skipped: false,
				role: null,
				primaryApplication: 'research-education',
				evaluationTimeline: 'evaluating-now'
			})
		).toBe('step4a');
	});

	it('routes an unanswered Continue to branch B', () => {
		expect(
			nextStepAfterStep2({
				skipped: false,
				role: null,
				primaryApplication: null,
				evaluationTimeline: null
			})
		).toBe('step4b');
	});

	// "Skip for now" means stop asking, so it terminates even when the selects were filled first
	// (that submission writes nothing either — see waitlist-steps.remote.ts).
	it('always terminates on Skip, even with commercial answers', () => {
		expect(
			nextStepAfterStep2({
				skipped: true,
				role: 'engineering-leader',
				primaryApplication: 'robotics-autonomous-systems',
				evaluationTimeline: 'evaluating-now'
			})
		).toBe('done');
	});
});

describe('nextStepAfterStep3', () => {
	it('goes to the branch step 2 decided', () => {
		expect(nextStepAfterStep3({ skipped: false, branch: 'step4a' })).toBe('step4a');
		expect(nextStepAfterStep3({ skipped: false, branch: 'step4b' })).toBe('step4b');
	});

	// Fail-safe: no verifiable claim → the branch that asks nothing sensitive.
	it('falls back to branch B without a verified claim', () => {
		expect(nextStepAfterStep3({ skipped: false, branch: null })).toBe('step4b');
	});

	it('always terminates on Skip, even with a branch-A claim', () => {
		expect(nextStepAfterStep3({ skipped: true, branch: 'step4a' })).toBe('done');
	});
});
