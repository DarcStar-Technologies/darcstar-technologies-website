import { describe, expect, it } from 'vitest';
import { validateWaitlist } from './waitlist';

describe('validateWaitlist', () => {
	it('accepts an email-only signup and normalizes the email to lowercase', () => {
		const { ok, cleaned, errors } = validateWaitlist({ email: '  Ada@Example.COM ' });
		expect(ok).toBe(true);
		expect(errors).toEqual([]);
		expect(cleaned.email).toBe('ada@example.com'); // lowercased for the unique-index dedupe
		expect(cleaned.name).toBeNull();
		expect(cleaned.role).toBeNull();
		expect(cleaned.interest).toBeNull();
	});

	it('rejects a missing or malformed email', () => {
		expect(validateWaitlist({}).errors).toContain('email');
		expect(validateWaitlist({ email: 'not-an-email' }).errors).toContain('email');
		expect(validateWaitlist({ email: 'a@b' }).errors).toContain('email'); // no dot in domain
	});

	it('coerces a valid role/companySize/hearAbout slug and nulls an unknown one without failing', () => {
		const good = validateWaitlist({
			email: 'a@b.co',
			role: 'engineering',
			companySize: '11-50',
			hearAbout: 'search'
		});
		expect(good.cleaned.role).toBe('engineering');
		expect(good.cleaned.companySize).toBe('11-50');
		expect(good.cleaned.hearAbout).toBe('search');

		const bad = validateWaitlist({
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
		const { cleaned } = validateWaitlist({ email: 'a@b.co', interest: '  Fleet logistics  ' });
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
			email: 'a@b.co',
			name: '   ',
			interest: '',
			phone: '  '
		});
		expect(cleaned.name).toBeNull();
		expect(cleaned.interest).toBeNull();
		expect(cleaned.phone).toBeNull();
	});
});
