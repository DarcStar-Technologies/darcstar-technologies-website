import { describe, expect, it } from 'vitest';
import { formatDate } from './date';

// Formatting is UTC-pinned so a datetime never slips a day by the runner's timezone. Assertions check
// the parts (month name, day, year) rather than an exact ordering, which varies by locale/ICU.
describe('formatDate', () => {
	it('formats an ISO datetime with the long month, day and year', () => {
		const out = formatDate('2026-07-22T10:00:00Z', 'en');
		expect(out).toContain('July');
		expect(out).toContain('22');
		expect(out).toContain('2026');
	});

	it('formats a date-only value without slipping a day (UTC)', () => {
		const out = formatDate('2024-06-05', 'en');
		expect(out).toContain('June');
		expect(out).toContain('5');
		expect(out).toContain('2024');
	});

	it('returns an empty string for null / empty / unparseable input', () => {
		expect(formatDate(null)).toBe('');
		expect(formatDate(undefined)).toBe('');
		expect(formatDate('')).toBe('');
		expect(formatDate('not-a-date')).toBe('');
	});
});
