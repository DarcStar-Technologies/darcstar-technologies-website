import { describe, expect, it } from 'vitest';
import {
	validateWaitlist,
	validateWaitlistStep2,
	validateWaitlistStep3,
	validateWaitlistStep4A,
	validateWaitlistStep4B
} from './waitlist';

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
			deploymentScale: '  x'.repeat(600),
			contactPermission: 'on',
			contactMethod: 'phone-video',
			phone: '+1 555 0100'
		});
		expect(cleaned.pilotInterest).toBe('yes-within-3-months');
		expect(cleaned.deploymentScale?.length).toBe(500);
		expect(cleaned.contactPermission).toBe(true);
		expect(cleaned.contactMethod).toBe('phone-video');
		expect(cleaned.phone).toBe('+1 555 0100');
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
