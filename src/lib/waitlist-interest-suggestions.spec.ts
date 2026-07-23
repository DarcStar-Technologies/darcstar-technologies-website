import { describe, expect, it } from 'vitest';
import { mergeInterestSuggestions } from './waitlist-interest-suggestions';

describe('mergeInterestSuggestions', () => {
	it('puts curated seeds first, then novel observed values', () => {
		const out = mergeInterestSuggestions(['Robotics', 'Markets'], ['Fleet logistics']);
		expect(out).toEqual(['Robotics', 'Markets', 'Fleet logistics']);
	});

	it('dedupes case-insensitively (first spelling wins) and drops blanks', () => {
		const out = mergeInterestSuggestions(['Robotics'], ['robotics', '  ', 'Markets', 'MARKETS']);
		expect(out).toEqual(['Robotics', 'Markets']);
	});

	it('trims entries', () => {
		expect(mergeInterestSuggestions([], ['  Trading  '])).toEqual(['Trading']);
	});

	it('caps the total number of suggestions and keeps seeds at the front', () => {
		const seed = ['Robotics', 'Markets'];
		const observed = Array.from({ length: 100 }, (_, i) => `interest ${i}`);
		const out = mergeInterestSuggestions(seed, observed);
		expect(out.length).toBeLessThanOrEqual(30);
		expect(out[0]).toBe('Robotics');
	});
});
