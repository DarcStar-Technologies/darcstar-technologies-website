import { describe, expect, it } from 'vitest';
import { hashIp, validateContact } from './contact';

const valid = {
	name: 'Ada Lovelace',
	email: 'ada@example.com',
	company: 'Analytical Engines',
	interest: 'robotics',
	message: 'I would like to discuss a control problem.'
};

describe('validateContact', () => {
	it('accepts a complete valid submission', () => {
		const r = validateContact(valid);
		expect(r.ok).toBe(true);
		expect(r.errors).toEqual([]);
		expect(r.cleaned).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			company: 'Analytical Engines',
			interest: 'robotics',
			message: 'I would like to discuss a control problem.'
		});
	});

	it('trims whitespace on all fields', () => {
		const r = validateContact({ ...valid, name: '  Ada  ', email: '  ada@example.com  ' });
		expect(r.cleaned.name).toBe('Ada');
		expect(r.cleaned.email).toBe('ada@example.com');
	});

	it('flags a missing or too-short name', () => {
		expect(validateContact({ ...valid, name: '' }).errors).toContain('name');
		expect(validateContact({ ...valid, name: 'A' }).errors).toContain('name');
	});

	it('flags an invalid email', () => {
		for (const email of ['', 'nope', 'a@b', 'a b@c.com']) {
			expect(validateContact({ ...valid, email }).errors).toContain('email');
		}
	});

	it('flags a too-short or over-long message', () => {
		expect(validateContact({ ...valid, message: 'too short' }).errors).toContain('message');
		expect(validateContact({ ...valid, message: 'a'.repeat(5001) }).errors).toContain('message');
	});

	it('treats company as optional (empty → null)', () => {
		expect(validateContact({ ...valid, company: '' }).cleaned.company).toBeNull();
	});

	it('nulls an unknown or empty interest instead of erroring', () => {
		const bogus = validateContact({ ...valid, interest: 'bogus' });
		expect(bogus.ok).toBe(true);
		expect(bogus.cleaned.interest).toBeNull();
		expect(validateContact({ ...valid, interest: '' }).cleaned.interest).toBeNull();
	});

	it('collects multiple errors and ignores non-string values', () => {
		const r = validateContact({ name: 123, email: null, message: undefined });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(expect.arrayContaining(['name', 'email', 'message']));
	});
});

describe('hashIp', () => {
	it('is deterministic and returns 32 hex chars', async () => {
		const a = await hashIp('203.0.113.7');
		expect(a).toBe(await hashIp('203.0.113.7'));
		expect(a).toMatch(/^[0-9a-f]{32}$/);
	});

	it('differs for different addresses', async () => {
		expect(await hashIp('203.0.113.7')).not.toBe(await hashIp('203.0.113.8'));
	});
});
