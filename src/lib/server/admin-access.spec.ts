import { describe, expect, test } from 'vitest';
import { parseAdminIds, isRosterAdmin } from './admin-access';

describe('parseAdminIds', () => {
	test('empty / undefined → []', () => {
		expect(parseAdminIds(undefined)).toEqual([]);
		expect(parseAdminIds('')).toEqual([]);
		expect(parseAdminIds('  ,  , ')).toEqual([]);
	});

	test('trims and drops empties', () => {
		expect(parseAdminIds('a, b ,,c,')).toEqual(['a', 'b', 'c']);
		expect(parseAdminIds(' solo ')).toEqual(['solo']);
	});
});

describe('isRosterAdmin', () => {
	test('no user → never admin', () => {
		expect(isRosterAdmin(null, 'a,b')).toBe(false);
		expect(isRosterAdmin(undefined, 'a,b')).toBe(false);
	});

	test('the admin role grants access regardless of the allowlist', () => {
		expect(isRosterAdmin({ id: 'x', role: 'admin' }, '')).toBe(true);
		expect(isRosterAdmin({ id: 'x', role: 'admin' }, undefined)).toBe(true);
	});

	test('an allowlisted id is admin even with a null / operator role (owner bootstrap)', () => {
		expect(isRosterAdmin({ id: 'x', role: null }, 'x')).toBe(true);
		expect(isRosterAdmin({ id: 'x', role: 'user' }, 'y,x,z')).toBe(true);
	});

	test('a plain operator not in the allowlist is not admin', () => {
		expect(isRosterAdmin({ id: 'z', role: 'user' }, 'x,y')).toBe(false);
		expect(isRosterAdmin({ id: 'z' }, '')).toBe(false);
	});
});
