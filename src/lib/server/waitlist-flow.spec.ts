import { describe, expect, it } from 'vitest';
import {
	canonicalizeWaitlistRole,
	isCommercialUseCase,
	audienceFor,
	WAITLIST_AUDIENCES,
	confirmationCtaFor,
	nextStepAfterStep2,
	nextStepAfterStep3,
	step4BranchFor,
	mintWaitlistFlowClaim,
	verifyWaitlistFlowClaim
} from './waitlist-flow';
import { mintWaitlistToken, mintSignedValue, WAITLIST_TOKEN_TTL_SECONDS } from './waitlist-token';
import { WAITLIST_ROLES } from '$lib/waitlist-roles';
import {
	WAITLIST_V2_ROLES,
	WAITLIST_APPLICATIONS,
	WAITLIST_TIMELINES,
	WAITLIST_PILOT_INTERESTS,
	WAITLIST_CTAS
} from '$lib/waitlist-qualification';
import type { WaitlistSigningSecret } from './waitlist-secret';

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

describe('audienceFor', () => {
	// The three-way split the CTA needs, over every role × application the predicate can see. It has to
	// agree with the step-3 gate on "commercial" and split the rest by whether anything was recognized.
	it.each(ROLE_INPUTS)('classifies role %s against every application', (role) => {
		for (const primaryApplication of APPLICATION_INPUTS) {
			const answers = { role, primaryApplication };
			const known =
				canonicalizeWaitlistRole(role) !== null ||
				(WAITLIST_APPLICATIONS as readonly string[]).includes(primaryApplication ?? '');
			const expected = isCommercialUseCase(answers) ? 'commercial' : known ? 'research' : 'general';

			expect(audienceFor(answers), `${role} / ${primaryApplication}`).toBe(expected);
		}
	});

	// Hand-written anchors, so an inverted formula above can't agree with itself.
	it('separates "told us nothing" from "told us they are a researcher"', () => {
		expect(audienceFor({ role: null, primaryApplication: null })).toBe('general');
		expect(audienceFor({ role: 'not-a-role', primaryApplication: 'nope' })).toBe('general');
		expect(audienceFor({ role: 'researcher', primaryApplication: null })).toBe('research');
		expect(audienceFor({ role: null, primaryApplication: 'research-education' })).toBe('research');
		expect(audienceFor({ role: 'student', primaryApplication: null })).toBe('research');
	});

	it('agrees with the step-3 gate on who is commercial', () => {
		expect(audienceFor({ role: 'engineering-leader', primaryApplication: null })).toBe(
			'commercial'
		);
		expect(
			audienceFor({ role: null, primaryApplication: 'industrial-infrastructure-control' })
		).toBe('commercial');
		// v1 slugs are history in the same column, so they must canonicalize here too.
		expect(audienceFor({ role: 'research', primaryApplication: null })).toBe('research');
		expect(audienceFor({ role: 'founder', primaryApplication: null })).toBe('commercial');
	});

	// Investors are non-commercial for the step-3 gate, so they land in the research bucket here.
	// DAR-65's classifier is where they get their own INTERNAL bucket — this is the visitor-facing CTA.
	it('puts investors with research rather than with prospects', () => {
		expect(audienceFor({ role: 'investor-advisor', primaryApplication: null })).toBe('research');
	});
});

describe('confirmationCtaFor', () => {
	// DAR-64 acceptance: the mapping for all four audiences.
	it('maps each audience to its call to action', () => {
		expect(
			confirmationCtaFor({ audience: 'commercial', pilotInterest: 'yes-within-3-months' })
		).toBe('pilot');
		expect(confirmationCtaFor({ audience: 'commercial' })).toBe('evidence');
		expect(confirmationCtaFor({ audience: 'research' })).toBe('research');
		expect(confirmationCtaFor({ audience: 'general' })).toBe('home');
	});

	// The mapping restated independently of the implementation, for the no-pilot case.
	const WITHOUT_PILOT = { commercial: 'evidence', research: 'research', general: 'home' } as const;

	// A positive pilot answer is the ONLY route to the conversation CTA, and it takes precedence over
	// every audience — it's the strongest thing a visitor can tell us. `not-currently` is the one
	// answer that isn't positive, so it falls back to whatever the audience alone earns.
	it.each(WAITLIST_PILOT_INTERESTS)('gates the pilot CTA on the %s answer', (pilotInterest) => {
		const positive = pilotInterest !== 'not-currently';
		for (const audience of ['commercial', 'research', 'general'] as const) {
			expect(confirmationCtaFor({ audience, pilotInterest }), `${audience}/${pilotInterest}`).toBe(
				positive ? 'pilot' : WITHOUT_PILOT[audience]
			);
		}
	});

	// The function's RANGE, not just its mapping: whatever it returns must be a slug the label map and
	// the component's href map actually cover. Both of those are `Record<WaitlistCta, …>`, so a new
	// variant is a type error there — this is the other half, catching a return value that drifts out
	// of the vocabulary those Records are keyed by.
	it('only ever returns a value from the published CTA vocabulary', () => {
		const audiences = [...WAITLIST_AUDIENCES, null];
		const pilots = [...WAITLIST_PILOT_INTERESTS, null, undefined, 'made-up'];
		for (const audience of audiences) {
			for (const pilotInterest of pilots) {
				expect(WAITLIST_CTAS, `${audience}/${pilotInterest}`).toContain(
					confirmationCtaFor({ audience, pilotInterest })
				);
			}
		}
	});

	// Fail-safe: nothing verifiable (absent/expired/tampered claim, or a skipped step 2) gets the
	// least-committal link, never a conversation.
	it('falls back to home for an unknown audience, and never invents a pilot', () => {
		expect(confirmationCtaFor({ audience: null })).toBe('home');
		expect(confirmationCtaFor({ audience: null, pilotInterest: null })).toBe('home');
		expect(confirmationCtaFor({ audience: null, pilotInterest: 'sure-why-not' })).toBe('home');
		expect(confirmationCtaFor({ audience: 'commercial', pilotInterest: 'not-currently' })).toBe(
			'evidence'
		);
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

// The claim is what stops a visitor opting into branch A's contact-collection — or into the pilot
// CTA — by editing the hidden field it rides in (DAR-63 / DAR-64 acceptance). It inherits the token's
// canonicalization + expiry rules (pinned in waitlist-token.spec.ts); what's pinned here is that it
// can't be forged or confused with a continuation token.
// Branded since DAR-99: production earns a signing secret from `waitlistSigningSecret()`, the one
// resolver every mint and verify now takes its key from. A fixture has no request to read, so the
// cast is the honest way to state one — the same shape `WaitlistFlowId`'s fixtures use.
const SECRET = 'test-secret-not-a-real-one' as WaitlistSigningSecret;
/** Another deployment's secret — same brand, different bytes. Nothing minted under it may verify here. */
const OTHER_SECRET = 'a-different-deployments-secret' as WaitlistSigningSecret;
const NOW = 1_800_000_000_000; // fixed ms clock — determinism, no Date.now() flake

describe('the flow claim', () => {
	it('roundtrips every branch × audience combination', async () => {
		for (const branch of ['step4a', 'step4b'] as const) {
			for (const audience of ['commercial', 'research', 'general'] as const) {
				const claim = await mintWaitlistFlowClaim(SECRET, { branch, audience }, NOW);
				await expect(verifyWaitlistFlowClaim(SECRET, claim, NOW)).resolves.toEqual({
					branch,
					audience
				});
			}
		}
	});

	it('rejects a claim edited from B to A (the whole point of signing it)', async () => {
		const claim = await mintWaitlistFlowClaim(
			SECRET,
			{ branch: 'step4b', audience: 'research' },
			NOW
		);
		const forged = claim.replace('step4b', 'step4a');
		expect(forged).not.toBe(claim); // the payload really is in the string
		await expect(verifyWaitlistFlowClaim(SECRET, forged, NOW)).resolves.toBeNull();
	});

	// The other half of the payload matters just as much now: promoting yourself to `commercial` would
	// swap the confirmation's CTA for one that offers a conversation.
	it('rejects a claim edited to upgrade the audience', async () => {
		const claim = await mintWaitlistFlowClaim(
			SECRET,
			{ branch: 'step4b', audience: 'general' },
			NOW
		);
		const forged = claim.replace('general', 'commercial');
		expect(forged).not.toBe(claim);
		await expect(verifyWaitlistFlowClaim(SECRET, forged, NOW)).resolves.toBeNull();
	});

	it('rejects an expired claim and one minted with a different secret', async () => {
		const state = { branch: 'step4a', audience: 'commercial' } as const;
		const claim = await mintWaitlistFlowClaim(SECRET, state, NOW);
		const atExpiry = NOW + WAITLIST_TOKEN_TTL_SECONDS * 1000;
		await expect(verifyWaitlistFlowClaim(SECRET, claim, atExpiry)).resolves.toBeNull();
		await expect(
			verifyWaitlistFlowClaim(SECRET, await mintWaitlistFlowClaim(OTHER_SECRET, state, NOW), NOW)
		).resolves.toBeNull();
	});

	// Domain separation: the two signed values key off the SAME secret, so neither may verify as the
	// other. A row id is not flow state, and a flow claim authorizes no write.
	it('never accepts a continuation token, and its own value is not a token', async () => {
		const token = await mintWaitlistToken(SECRET, 'row-1', NOW);
		await expect(verifyWaitlistFlowClaim(SECRET, token, NOW)).resolves.toBeNull();

		// Even with the claim's prefix, a MAC signed under the token's domain must not verify.
		const wrongDomain = await mintSignedValue(
			SECRET,
			'darcstar:waitlist-continuation:v1',
			'f1',
			'step4a|commercial',
			WAITLIST_TOKEN_TTL_SECONDS,
			NOW
		);
		await expect(verifyWaitlistFlowClaim(SECRET, wrongDomain, NOW)).resolves.toBeNull();
	});

	// A validly-signed but wrong-shaped payload can't be produced without the secret — but the parse
	// narrows rather than casts, so pin that it does. (Half a payload is not half an answer.)
	it('rejects a validly signed payload that is not a branch and an audience', async () => {
		for (const payload of ['step4a', 'commercial', 'step4a|', 'step4a|nope', 'nope|commercial']) {
			const claim = await mintSignedValue(
				SECRET,
				'darcstar:waitlist-flow:v1',
				'f1',
				payload,
				WAITLIST_TOKEN_TTL_SECONDS,
				NOW
			);
			await expect(verifyWaitlistFlowClaim(SECRET, claim, NOW), payload).resolves.toBeNull();
		}
	});

	it('rejects malformed shapes without throwing (generic null — no oracle)', async () => {
		for (const junk of [
			null,
			undefined,
			42,
			'',
			'step4a',
			'f1',
			'f1.step4a|general.9999999999.@@@@'
		]) {
			await expect(verifyWaitlistFlowClaim(SECRET, junk, NOW)).resolves.toBeNull();
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
