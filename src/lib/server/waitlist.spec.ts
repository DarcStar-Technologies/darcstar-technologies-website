import { describe, expect, it } from 'vitest';
import {
	hasAnyAnswer,
	validateWaitlist,
	validateWaitlistStep2,
	validateWaitlistStep3,
	validateWaitlistStep4A,
	validateWaitlistStep4B
} from './waitlist';
import {
	WAITLIST_ANNUAL_BUDGETS,
	WAITLIST_POSITIVE_PILOT_INTERESTS
} from '$lib/waitlist-qualification';

describe('validateWaitlist', () => {
	it('accepts a name + email signup and normalizes the email to lowercase', () => {
		const { ok, cleaned, errors } = validateWaitlist({
			name: '  Ada Lovelace  ',
			email: '  Ada@Example.COM '
		});
		expect(ok).toBe(true);
		expect(errors).toEqual([]);
		expect(cleaned.email).toBe('ada@example.com'); // lowercased for the unique-index dedupe
		expect(cleaned.name).toBe('Ada Lovelace'); // trimmed
		expect(cleaned.role).toBeNull();
		expect(cleaned.interest).toBeNull();
	});

	it('requires name (v2 step 1) — blank or absent fails with a name issue', () => {
		expect(validateWaitlist({ email: 'a@b.co' }).errors).toContain('name');
		const blank = validateWaitlist({ email: 'a@b.co', name: '   ' });
		expect(blank.ok).toBe(false);
		expect(blank.errors).toContain('name');
		expect(blank.cleaned.name).toBeNull(); // whitespace-only normalizes to null
		// A real name clears it.
		expect(validateWaitlist({ email: 'a@b.co', name: 'Ada' }).ok).toBe(true);
	});

	it('rejects a missing or malformed email (name held valid to isolate the email check)', () => {
		expect(validateWaitlist({ name: 'Ada' }).errors).toContain('email');
		expect(validateWaitlist({ name: 'Ada', email: 'not-an-email' }).errors).toContain('email');
		expect(validateWaitlist({ name: 'Ada', email: 'a@b' }).errors).toContain('email'); // no dot in domain
	});

	it('coerces a valid role/companySize/hearAbout slug and nulls an unknown one without failing', () => {
		const good = validateWaitlist({
			name: 'Ada',
			email: 'a@b.co',
			role: 'engineering',
			companySize: '11-50',
			hearAbout: 'search'
		});
		expect(good.cleaned.role).toBe('engineering');
		expect(good.cleaned.companySize).toBe('11-50');
		expect(good.cleaned.hearAbout).toBe('search');

		const bad = validateWaitlist({
			name: 'Ada',
			email: 'a@b.co',
			role: 'wizard',
			companySize: '999',
			hearAbout: 'telepathy'
		});
		expect(bad.ok).toBe(true); // unknown slugs are coerced, never rejected
		expect(bad.cleaned.role).toBeNull();
		expect(bad.cleaned.companySize).toBeNull();
		expect(bad.cleaned.hearAbout).toBeNull();
	});

	it('keeps interest as free text (trimmed), not constrained to an enum', () => {
		// The interest COLUMN survives DAR-60 (only its form datalist was retired), so the validator
		// still cleans a supplied value.
		const { cleaned } = validateWaitlist({
			name: 'Ada',
			email: 'a@b.co',
			interest: '  Fleet logistics  '
		});
		expect(cleaned.interest).toBe('Fleet logistics');
	});

	it('caps long free-text fields to their ceilings', () => {
		const long = 'x'.repeat(500);
		const { cleaned } = validateWaitlist({
			email: 'a@b.co',
			interest: long,
			name: long,
			company: long,
			phone: long
		});
		expect(cleaned.interest?.length).toBe(120);
		expect(cleaned.name?.length).toBe(100);
		expect(cleaned.company?.length).toBe(200);
		expect(cleaned.phone?.length).toBe(40);
	});

	it('treats blank optional fields as null', () => {
		const { cleaned } = validateWaitlist({
			name: 'Ada',
			email: 'a@b.co',
			company: '   ',
			interest: '',
			phone: '  '
		});
		expect(cleaned.company).toBeNull();
		expect(cleaned.interest).toBeNull();
		expect(cleaned.phone).toBeNull();
	});

	it('v2 step-1 fields: countryRegion coerces like the other slugs; consent parses as a checkbox', () => {
		const good = validateWaitlist({
			name: 'Ada',
			email: 'a@b.co',
			countryRegion: 'europe',
			consentUpdates: 'on'
		});
		expect(good.cleaned.countryRegion).toBe('europe');
		expect(good.cleaned.consentUpdates).toBe(true);

		const bad = validateWaitlist({ name: 'Ada', email: 'a@b.co', countryRegion: 'atlantis' });
		expect(bad.cleaned.countryRegion).toBeNull();
		// Absent checkbox is FALSE, never null — absence of the field is not consent.
		expect(bad.cleaned.consentUpdates).toBe(false);
		// PRESENCE is the signal: any non-empty checkbox value ('on'/'yes'/'1'/'true') is a grant, so
		// a future form that ships a value= attribute can't silently drop the opt-in.
		expect(validateWaitlist({ email: 'a@b.co', consentUpdates: '1' }).cleaned.consentUpdates).toBe(
			true
		);
		expect(
			validateWaitlist({ email: 'a@b.co', consentUpdates: 'yes' }).cleaned.consentUpdates
		).toBe(true);
		// An empty string (or non-string) is still not a grant.
		expect(validateWaitlist({ email: 'a@b.co', consentUpdates: '' }).cleaned.consentUpdates).toBe(
			false
		);
	});
});

// The step validators share the v1 posture: nothing is required, unknown slugs coerce to null
// (they never reach the DB), arrays are allowlisted + deduped + capped. Each emits exactly its own
// step's columns — the mass-assignment guard the store relies on.
describe('validateWaitlistStep2', () => {
	it('accepts valid slugs and nulls unknown ones', () => {
		const good = validateWaitlistStep2({
			role: 'engineering-leader',
			primaryApplication: 'robotics-autonomous-systems',
			evaluationTimeline: 'within-3-months'
		});
		expect(good).toEqual({
			role: 'engineering-leader',
			primaryApplication: 'robotics-autonomous-systems',
			evaluationTimeline: 'within-3-months'
		});

		const bad = validateWaitlistStep2({
			role: 'founder', // a v1 slug — historical only, not accepted for new writes
			primaryApplication: 'time-travel',
			evaluationTimeline: 42
		});
		expect(bad).toEqual({ role: null, primaryApplication: null, evaluationTimeline: null });
	});
});

describe('validateWaitlistStep3', () => {
	it('coerces the three selects and allowlists the evidence multi-select', () => {
		const cleaned = validateWaitlistStep3({
			currentApproach: 'internal-system',
			economicImpact: 'over-1m',
			budgetRange: 'not-sure',
			adoptionEvidence: ['formal-proof-artifacts', 'production-references']
		});
		expect(cleaned.currentApproach).toBe('internal-system');
		expect(cleaned.economicImpact).toBe('over-1m');
		expect(cleaned.budgetRange).toBe('not-sure');
		expect(cleaned.adoptionEvidence).toEqual(['formal-proof-artifacts', 'production-references']);
	});

	// DAR-126's retired annual bands are stored history, never an answer to the question the form asks
	// now. The allowlist is what enforces that — an accepted `25k-100k` would put an annual figure into
	// the same column under the new question's meaning, which is precisely the ambiguity the re-banding
	// exists to prevent.
	it('refuses a retired annual budget band', () => {
		for (const retired of WAITLIST_ANNUAL_BUDGETS) {
			expect(validateWaitlistStep3({ budgetRange: retired }).budgetRange, retired).toBeNull();
		}
	});

	it('caps adoption evidence at 3, dedupes, and drops junk entries', () => {
		const { adoptionEvidence } = validateWaitlistStep3({
			adoptionEvidence: [
				'evaluation-pilot',
				'evaluation-pilot', // dupe
				'bribery', // junk
				'formal-proof-artifacts',
				'performance-benchmarks',
				'third-party-review' // 4th valid — over the cap
			]
		});
		expect(adoptionEvidence).toEqual([
			'evaluation-pilot',
			'formal-proof-artifacts',
			'performance-benchmarks'
		]);
	});

	it('normalizes a single value to a one-element array and all-junk to null', () => {
		expect(validateWaitlistStep3({ adoptionEvidence: 'sla-support' }).adoptionEvidence).toEqual([
			'sla-support'
		]);
		expect(validateWaitlistStep3({ adoptionEvidence: ['nope', 7] }).adoptionEvidence).toBeNull();
		expect(validateWaitlistStep3({}).adoptionEvidence).toBeNull();
	});
});

describe('validateWaitlistStep4A', () => {
	it('cleans the pilot answers and caps the deployment-scale free text at 500', () => {
		const cleaned = validateWaitlistStep4A({
			pilotInterest: 'yes-within-3-months',
			loiReadiness: 'possibly-after-discussion',
			deploymentScale: '  x'.repeat(600),
			contactPermission: 'on',
			contactMethod: 'phone-video',
			phone: '+1 555 0100'
		});
		expect(cleaned.pilotInterest).toBe('yes-within-3-months');
		expect(cleaned.loiReadiness).toBe('possibly-after-discussion');
		expect(cleaned.deploymentScale?.length).toBe(500);
		expect(cleaned.contactPermission).toBe(true);
		expect(cleaned.contactMethod).toBe('phone-video');
		expect(cleaned.phone).toBe('+1 555 0100');
	});

	// DAR-112. The LOI question shares contact_permission's gate, and the case that makes the gate
	// necessary is the NO-JS one rather than a crafted POST: without JS the whole block renders whatever
	// the pilot answer is, so a visitor really can submit "yes, we'd consider signing" together with
	// "not currently" for the evaluation itself. Storing both would manufacture a contradiction the
	// person never expressed, and leave an operator reconciling a disagreement created by our rendering.
	it('drops an LOI answer when the pilot answer is not positive (the no-JS submit)', () => {
		expect(
			validateWaitlistStep4A({ pilotInterest: 'not-currently', loiReadiness: 'yes' }).loiReadiness
		).toBeNull();
		// Unanswered pilot question, same rule — the block was never earned.
		expect(validateWaitlistStep4A({ loiReadiness: 'yes' }).loiReadiness).toBeNull();
	});

	it('keeps an LOI answer for every positive pilot answer', () => {
		// Pinned across the whole positive set rather than one sample: the two lists are separate
		// constants, so a slug promoted into WAITLIST_POSITIVE_PILOT_INTERESTS must carry this question
		// with it. A single-value test would pass while a newly-positive answer silently dropped it.
		for (const pilotInterest of WAITLIST_POSITIVE_PILOT_INTERESTS) {
			expect(validateWaitlistStep4A({ pilotInterest, loiReadiness: 'yes' }).loiReadiness).toBe(
				'yes'
			);
		}
	});

	// The gate is SCOPED, not blanket, and this is the assertion that says so: all five of step 4A's
	// fields live inside the block DAR-63 reveals, and only the two whose meaning depends on wanting an
	// evaluation are dropped. A deployment description, a contact method and a phone number stay true
	// whatever the pilot answer is, so gating them would discard something the visitor did mean — which
	// is exactly what a later "tidy-up" that gated the whole block would do.
	it('keeps the standalone answers when the pilot answer is not positive', () => {
		const cleaned = validateWaitlistStep4A({
			pilotInterest: 'not-currently',
			loiReadiness: 'yes',
			deploymentScale: 'Two inspection cells',
			contactPermission: 'on',
			contactMethod: 'phone-video',
			phone: '+1 555 0100'
		});
		// Scoped to an evaluation they just declined → never asked.
		expect(cleaned.loiReadiness).toBeNull();
		expect(cleaned.contactPermission).toBeNull();
		// Standalone facts → kept.
		expect(cleaned.deploymentScale).toBe('Two inspection cells');
		expect(cleaned.contactMethod).toBe('phone-video');
		expect(cleaned.phone).toBe('+1 555 0100');
	});

	it('coerces an unknown LOI slug to null even on the positive path', () => {
		expect(
			validateWaitlistStep4A({ pilotInterest: 'yes-within-3-months', loiReadiness: 'signed' })
				.loiReadiness
		).toBeNull();
	});

	// contact_permission is TRI-STATE, gated on a positive pilot answer (the only case where DAR-63
	// renders the checkbox): true = granted, false = shown+declined, null = the question wasn't shown.
	it('records a decline (false) when the pilot answer is positive but the box is absent', () => {
		expect(validateWaitlistStep4A({ pilotInterest: 'possibly-contact-me' }).contactPermission).toBe(
			false
		);
	});

	it('emits null contact permission when pilot interest is NOT positive (question not shown)', () => {
		// A negative pilot answer with a (spurious) ticked box must NOT record a grant OR a decline —
		// the question was never shown, so the store keep-existings this null.
		expect(
			validateWaitlistStep4A({ pilotInterest: 'not-currently', contactPermission: 'on' })
				.contactPermission
		).toBeNull();
		expect(validateWaitlistStep4A({}).contactPermission).toBeNull();
	});

	it('defaults everything absent to null', () => {
		expect(validateWaitlistStep4A({})).toEqual({
			pilotInterest: null,
			loiReadiness: null,
			deploymentScale: null,
			contactPermission: null,
			contactMethod: null,
			phone: null
		});
	});
});

describe('validateWaitlistStep4B', () => {
	it('allowlists + dedupes the research preferences (whole list selectable)', () => {
		const all = [
			'technical-reports',
			'verification-artifacts',
			'performance-benchmarks',
			'product-demos',
			'open-source-releases',
			'company-announcements'
		];
		expect(validateWaitlistStep4B({ researchPreferences: [...all, 'spam'] })).toEqual({
			researchPreferences: all
		});
		expect(validateWaitlistStep4B({}).researchPreferences).toBeNull();
	});
});

// The step endpoints skip the DB write when a Continue carried no answers. This replaced four
// hand-maintained OR chains whose failure mode was silent: miss a field, and a submission answering
// only THAT field would persist nothing at all.
describe('hasAnyAnswer', () => {
	const empty = () => [
		validateWaitlistStep2({}),
		validateWaitlistStep3({}),
		validateWaitlistStep4A({}),
		validateWaitlistStep4B({})
	];

	const answered = () => [
		validateWaitlistStep2({
			role: 'student',
			primaryApplication: 'research-education',
			evaluationTimeline: 'evaluating-now'
		}),
		validateWaitlistStep3({
			currentApproach: 'internal-system',
			economicImpact: 'over-1m',
			budgetRange: '25k-50k',
			adoptionEvidence: ['evaluation-pilot']
		}),
		validateWaitlistStep4A({
			pilotInterest: 'yes-within-3-months',
			loiReadiness: 'yes',
			deploymentScale: 'two cells',
			contactPermission: 'on',
			contactMethod: 'phone-video',
			phone: '+1 555 000 1234'
		}),
		validateWaitlistStep4B({ researchPreferences: ['technical-reports'] })
	];

	it('is false for an untouched payload of every step', () => {
		for (const cleaned of empty())
			expect(hasAnyAnswer(cleaned), JSON.stringify(cleaned)).toBe(false);
	});

	it('is true for a fully answered payload of every step', () => {
		for (const cleaned of answered()) expect(hasAnyAnswer(cleaned)).toBe(true);
	});

	// The property the OR chains kept failing to guarantee: EVERY field on its own is enough to
	// trigger the write. Enumerated from the validator output, so a new column is covered the moment
	// the validator emits it — no test to remember to extend.
	it('sees an answer in any single field, for every step', () => {
		for (const cleaned of answered()) {
			for (const [field, value] of Object.entries(cleaned)) {
				const onlyThisField = Object.fromEntries(
					Object.keys(cleaned).map((key) => [key, key === field ? value : null])
				);
				expect(hasAnyAnswer(onlyThisField), field).toBe(true);
			}
		}
	});

	// Tri-state, not truthiness: an explicit "no, do not contact me" must still be written.
	it('counts a declined contact permission as an answer', () => {
		const declined = validateWaitlistStep4A({ pilotInterest: 'yes-within-3-months' });
		expect(declined.contactPermission).toBe(false);
		expect(hasAnyAnswer({ ...declined, pilotInterest: null })).toBe(true);
	});
});
